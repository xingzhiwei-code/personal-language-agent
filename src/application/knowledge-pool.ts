import type {
  KnowledgeItem,
  KnowledgeOperationLog,
  LearnerState,
  LearningEvent,
} from '@/domain/entities';
import { validationFailed } from '@/domain/errors';
import { createInitialState } from '@/learner/state';
import { scorePoolRelevance, type ScoredPoolItem } from '@/scheduler/relevance';
import { appendEvent } from './events';
import { localDayKey } from './local-day';
import { listScenarios } from './scenarios';
import type { AppContext } from './types';

export const DEFAULT_DAILY_NEW_WORD_BUDGET = 10;
export const MAX_DAILY_NEW_WORD_BUDGET = 50;
export const MAX_MANUAL_POOL_BATCH = 100;

export interface PoolPromotionResult {
  promoted: KnowledgeItem[];
  scored: ScoredPoolItem[];
  budget: number;
  reason: string | null;
}

/**
 * Applies the natural-day automatic new-word budget before a new plan is made.
 * Day boundaries intentionally use UTC because all persisted timestamps are UTC.
 */
export async function ensureDailyPoolPromotion(
  ctx: AppContext,
  learnerId: string,
): Promise<PoolPromotionResult> {
  const budget = await getDailyNewWordBudget(ctx, learnerId);
  if (budget === 0) return { promoted: [], scored: [], budget, reason: null };
  const now = ctx.clock.nowIso();
  const poolItems = await ctx.repos.knowledge.search({
    learnerId,
    statuses: ['new'],
    limit: 20_000,
  });
  if (poolItems.length === 0) return { promoted: [], scored: [], budget, reason: null };

  const goal = await ctx.repos.goals.findPrimary(learnerId);
  const [targets, skillStates, wordlists, relations, knowledgeStates, activeScenarios] =
    await Promise.all([
      goal ? ctx.repos.targets.listByGoal(goal.id) : Promise.resolve([]),
      ctx.repos.states.listBySubjectType(learnerId, 'skill'),
      ctx.repos.wordlists.listByLearner(learnerId),
      ctx.repos.relations.listByLearner(learnerId),
      ctx.repos.states.listBySubjectType(learnerId, 'knowledge_item'),
      listScenarios(ctx, learnerId).then((scenarios) =>
        scenarios.filter((scenario) => scenario.status === 'active'),
      ),
    ]);
  const recentLearnedItemIds = knowledgeStates
    .filter((state) => state.lastPracticedAt !== null)
    .sort((a, b) => (b.lastPracticedAt ?? '').localeCompare(a.lastPracticedAt ?? ''))
    .slice(0, 50)
    .map((state) => state.subjectId);
  const scored = scorePoolRelevance({
    goal,
    targets,
    skillStates,
    items: poolItems,
    wordlists,
    relations,
    recentLearnedItemIds,
    activeScenarios,
    nowIso: now,
  });
  const selected = scored.slice(0, budget);
  const promoted = await commitPromotion(ctx, {
    learnerId,
    selected,
    mode: 'automatic',
    automaticBudget: { dayKey: localDayKey(now), budget },
  });
  const selectedById = new Map(scored.map((entry) => [entry.item.id, entry]));
  const promotedScored = promoted
    .map((item) => selectedById.get(item.id))
    .filter((entry): entry is ScoredPoolItem => entry !== undefined);
  return {
    promoted,
    scored: promotedScored,
    budget,
    reason: promotedScored[0]?.reason ?? null,
  };
}

export async function promoteKnowledgeItems(
  ctx: AppContext,
  input: { learnerId: string; itemIds: string[] },
): Promise<KnowledgeItem[]> {
  const ids = uniqueIds(input.itemIds);
  if (ids.length === 0) throw validationFailed('请至少选择一个词库池条目');
  if (ids.length > MAX_MANUAL_POOL_BATCH) {
    throw validationFailed(`一次最多加入 ${MAX_MANUAL_POOL_BATCH} 条`);
  }
  const items = await ctx.repos.knowledge.listByIds(ids);
  const owned = items.filter((item) => item.learnerId === input.learnerId && item.status === 'new');
  const selected: ScoredPoolItem[] = owned.map((item) => ({
    item,
    score: 0,
    factors: {
      wordlistBinding: 0,
      tagMatch: 0,
      skillGap: 0,
      frequency: item.frequencyRank === null ? 0.5 : 1 - item.frequencyRank,
      graphRelation: 0,
    },
    reason: '用户手动加入学习',
  }));
  return commitPromotion(ctx, { learnerId: input.learnerId, selected, mode: 'manual' });
}

export async function pauseKnowledgeItems(
  ctx: AppContext,
  input: { learnerId: string; itemIds: string[] },
): Promise<KnowledgeItem[]> {
  const ids = uniqueIds(input.itemIds);
  if (ids.length === 0) throw validationFailed('请至少选择一个学习中条目');
  if (ids.length > MAX_MANUAL_POOL_BATCH) {
    throw validationFailed(`一次最多暂停 ${MAX_MANUAL_POOL_BATCH} 条`);
  }
  const now = ctx.clock.nowIso();
  const items = await ctx.repos.knowledge.listByIds(ids);
  const selected = items.filter(
    (item) => item.learnerId === input.learnerId && item.status === 'active',
  );
  const logs: KnowledgeOperationLog[] = selected.map((item) => ({
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    operation: 'pause_to_pool',
    knowledgeItemId: item.id,
    itemText: item.text,
    changes: { status: ['active', 'new'] },
    source: 'manual',
    note: '用户暂停学习并放回词库池',
    createdAt: now,
  }));
  const paused = await ctx.repos.knowledgePool.pause({
    learnerId: input.learnerId,
    itemIds: selected.map((item) => item.id),
    nowIso: now,
    logs,
  });
  if (paused.length > 0) {
    await appendEvent(ctx, {
      learnerId: input.learnerId,
      type: 'knowledge_updated',
      source: 'user',
      idempotencyKey: `knowledge-paused:${now}:${paused.map((item) => item.id).join(',')}`,
      payload: { itemIds: paused.map((item) => item.id), status: 'new' },
    });
  }
  return paused;
}

export async function getDailyNewWordBudget(ctx: AppContext, learnerId: string): Promise<number> {
  const preference = await ctx.repos.preferences.findByKey(learnerId, 'daily_new_word_budget');
  if (!preference) return DEFAULT_DAILY_NEW_WORD_BUDGET;
  const value = Number(preference.value);
  if (!Number.isInteger(value)) return DEFAULT_DAILY_NEW_WORD_BUDGET;
  return Math.max(0, Math.min(MAX_DAILY_NEW_WORD_BUDGET, value));
}

async function commitPromotion(
  ctx: AppContext,
  input: {
    learnerId: string;
    selected: ScoredPoolItem[];
    mode: 'automatic' | 'manual';
    automaticBudget?: { dayKey: string; budget: number };
  },
): Promise<KnowledgeItem[]> {
  if (input.selected.length === 0) return [];
  const now = ctx.clock.nowIso();
  const states: LearnerState[] = input.selected.map(({ item }) => ({
    ...createInitialState({
      id: ctx.ids.next(),
      learnerId: input.learnerId,
      subjectType: 'knowledge_item',
      subjectId: item.id,
      nowIso: now,
    }),
    nextReviewAt: now,
  }));
  const logs: KnowledgeOperationLog[] = input.selected.map(({ item, reason, factors }) => ({
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    operation: 'promote_to_learning',
    knowledgeItemId: item.id,
    itemText: item.text,
    changes: { status: ['new', 'active'], relevance: factors },
    source: input.mode === 'automatic' ? item.entryMethod : 'manual',
    note: input.mode === 'automatic' ? `每日预算自动加入：${reason}` : reason,
    createdAt: now,
  }));
  const event: LearningEvent = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    sessionId: null,
    type: 'knowledge_pool_promoted',
    occurredAt: now,
    payload: { mode: input.mode, dayKey: localDayKey(now), itemIds: [], count: 0 },
    source: input.mode === 'automatic' ? 'system' : 'user',
    version: 1,
    idempotencyKey:
      input.mode === 'automatic'
        ? `pool-auto:${localDayKey(now)}:${input.selected[0]!.item.id}`
        : `pool-manual:${now}:${input.selected[0]!.item.id}`,
    createdAt: now,
  };
  return ctx.repos.knowledgePool.promote({
    learnerId: input.learnerId,
    itemIds: input.selected.map(({ item }) => item.id),
    states,
    logs,
    event,
    automaticBudget: input.automaticBudget,
  });
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
