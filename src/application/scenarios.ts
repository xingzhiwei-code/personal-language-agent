import type { Scenario, TimeContext, Wordlist } from '@/domain/entities';
import type { ScenarioStatus, ScenarioType, TimeContextPreset } from '@/domain/enums';
import { notFound, validationFailed } from '@/domain/errors';
import { recordKnowledgeOperation } from './audit';
import { appendEvent } from './events';
import type { AppContext } from './types';

export interface CreateScenarioInput {
  learnerId: string;
  name: string;
  type: ScenarioType;
  goalId?: string | null;
  parentId?: string | null;
  timePreset?: TimeContextPreset | null;
  timeText?: string | null;
}

export async function createScenario(
  ctx: AppContext,
  input: CreateScenarioInput,
): Promise<Scenario> {
  const name = input.name.trim();
  if (!name) throw validationFailed('场景名称不能为空');
  if (name.length > 120) throw validationFailed('场景名称不能超过 120 字符');
  await validateGoal(ctx, input.learnerId, input.goalId ?? null);
  await validateParent(ctx, input.learnerId, input.type, input.parentId ?? null);
  const now = ctx.clock.nowIso();
  const scenario: Scenario = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    goalId: input.goalId ?? null,
    parentId: input.type === 'small' ? input.parentId ?? null : null,
    name,
    type: input.type,
    timeContext: resolveTimeContext(now, input.timePreset ?? null, input.timeText ?? null),
    status: 'active',
    knowledgeItemIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.scenarios.create(scenario);
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'scenario_created',
    source: 'user',
    idempotencyKey: `scenario-created:${scenario.id}`,
    payload: { scenarioId: scenario.id, goalId: scenario.goalId, type: scenario.type },
  });
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `创建场景：${scenario.name}`,
  });
  return scenario;
}

export async function updateScenario(
  ctx: AppContext,
  input: {
    learnerId: string;
    scenarioId: string;
    name?: string;
    goalId?: string | null;
    status?: ScenarioStatus;
    timePreset?: TimeContextPreset | null;
    timeText?: string | null;
  },
): Promise<Scenario> {
  const scenario = await ctx.repos.scenarios.findById(input.scenarioId);
  if (!scenario || scenario.learnerId !== input.learnerId) throw notFound('Scenario', input.scenarioId);
  const name = input.name?.trim() ?? scenario.name;
  if (!name) throw validationFailed('场景名称不能为空');
  await validateGoal(ctx, input.learnerId, input.goalId === undefined ? scenario.goalId : input.goalId);
  const now = ctx.clock.nowIso();
  const updated: Scenario = {
    ...scenario,
    name,
    goalId: input.goalId === undefined ? scenario.goalId : input.goalId,
    status: input.status ?? scenario.status,
    timeContext:
      input.timePreset === undefined
        ? scenario.timeContext
        : resolveTimeContext(now, input.timePreset, input.timeText ?? null),
    updatedAt: now,
  };
  await ctx.repos.scenarios.update(updated);
  const archived = scenario.status === 'active' && updated.status === 'done';
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: archived ? 'scenario_archived' : 'scenario_updated',
    source: 'user',
    idempotencyKey: `scenario-updated:${scenario.id}:${now}`,
    payload: { scenarioId: scenario.id, goalId: updated.goalId, status: updated.status },
  });
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `${archived ? '完成' : '更新'}场景：${updated.name}`,
  });
  return updated;
}

export async function deleteScenario(
  ctx: AppContext,
  learnerId: string,
  scenarioId: string,
): Promise<void> {
  const scenario = await ctx.repos.scenarios.findById(scenarioId);
  if (!scenario || scenario.learnerId !== learnerId) throw notFound('Scenario', scenarioId);
  const children = (await ctx.repos.scenarios.listByLearner(learnerId)).filter(
    (candidate) => candidate.parentId === scenarioId,
  );
  if (children.length > 0) throw validationFailed('请先删除或调整这个大场景下的小场景');
  await ctx.repos.scenarios.delete(scenarioId);
  await recordKnowledgeOperation(ctx, {
    learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `删除场景：${scenario.name}`,
  });
}

export async function listScenarios(ctx: AppContext, learnerId: string): Promise<Scenario[]> {
  const activeBefore = await ctx.repos.scenarios.listByLearner(learnerId, ['active']);
  const expired = activeBefore.filter(
    (scenario) => scenario.timeContext?.resolvedDueAt && scenario.timeContext.resolvedDueAt <= ctx.clock.nowIso(),
  );
  if (expired.length > 0) {
    await ctx.repos.scenarios.archiveExpired(learnerId, ctx.clock.nowIso());
    for (const scenario of expired) {
      await appendEvent(ctx, {
        learnerId,
        type: 'scenario_archived',
        source: 'system',
        idempotencyKey: `scenario-auto-archived:${scenario.id}:${scenario.timeContext?.resolvedDueAt}`,
        payload: { scenarioId: scenario.id, reason: 'time_context_expired' },
      });
      await recordKnowledgeOperation(ctx, {
        learnerId,
        operation: 'goal_binding_changed',
        source: 'manual',
        note: `场景到期自动归档：${scenario.name}`,
      });
    }
  }
  return ctx.repos.scenarios.listByLearner(learnerId);
}

export async function bindItemsToScenario(
  ctx: AppContext,
  input: { learnerId: string; scenarioId: string; itemIds: string[] },
): Promise<Scenario> {
  const scenario = await ctx.repos.scenarios.findById(input.scenarioId);
  if (!scenario || scenario.learnerId !== input.learnerId) {
    throw notFound('Scenario', input.scenarioId);
  }
  const ids = [...new Set(input.itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw validationFailed('请至少选择一条表达');
  if (ids.length > 100) throw validationFailed('一次最多绑定 100 条');
  // `listByIds` has no deterministic ordering (SQLite returns by id index, and
  // ids are random UUIDs), so re-derive the bound order from the caller's input
  // instead of the repository's return order. This also scopes to owned items.
  const items = await ctx.repos.knowledge.listByIds(ids);
  const ownedById = new Map(
    items.filter((item) => item.learnerId === input.learnerId).map((item) => [item.id, item]),
  );
  const ownedIds = ids.filter((id) => ownedById.has(id));
  if (ownedIds.length === 0) throw validationFailed('所选表达不存在');

  const merged = [...new Set([...scenario.knowledgeItemIds, ...ownedIds])];
  const updated: Scenario = {
    ...scenario,
    knowledgeItemIds: merged,
    updatedAt: ctx.clock.nowIso(),
  };
  await ctx.repos.scenarios.update(updated);
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `绑定 ${ownedIds.length} 条表达到场景「${scenario.name}」`,
  });
  return updated;
}

export async function unbindItemFromScenario(
  ctx: AppContext,
  input: { learnerId: string; scenarioId: string; itemId: string },
): Promise<Scenario> {
  const scenario = await ctx.repos.scenarios.findById(input.scenarioId);
  if (!scenario || scenario.learnerId !== input.learnerId) {
    throw notFound('Scenario', input.scenarioId);
  }
  if (!scenario.knowledgeItemIds.includes(input.itemId)) return scenario;
  const updated: Scenario = {
    ...scenario,
    knowledgeItemIds: scenario.knowledgeItemIds.filter((id) => id !== input.itemId),
    updatedAt: ctx.clock.nowIso(),
  };
  await ctx.repos.scenarios.update(updated);
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `从场景「${scenario.name}」移除表达`,
  });
  return updated;
}

export async function bindWordlistToGoal(
  ctx: AppContext,
  input: { learnerId: string; wordlistId: string; goalId: string | null },
): Promise<Wordlist> {
  const wordlist = await ctx.repos.wordlists.findById(input.wordlistId);
  if (!wordlist || wordlist.learnerId !== input.learnerId) throw notFound('Wordlist', input.wordlistId);
  await validateGoal(ctx, input.learnerId, input.goalId);
  const updated = { ...wordlist, goalId: input.goalId, updatedAt: ctx.clock.nowIso() };
  await ctx.repos.wordlists.update(updated);
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `${wordlist.name} ${input.goalId ? '已绑定目标' : '已取消目标绑定'}`,
  });
  return updated;
}

function resolveTimeContext(
  nowIso: string,
  preset: TimeContextPreset | null,
  freeText: string | null,
): TimeContext | null {
  if (!preset) return null;
  const days: Record<Exclude<TimeContextPreset, 'long_term'>, number> = {
    today: 1,
    this_week: 7,
    next_week: 14,
    this_month: 30,
    this_quarter: 90,
  };
  return {
    preset,
    freeText: freeText?.trim().slice(0, 120) || null,
    resolvedDueAt:
      preset === 'long_term'
        ? null
        : new Date(Date.parse(nowIso) + days[preset] * 86_400_000).toISOString(),
  };
}

async function validateGoal(ctx: AppContext, learnerId: string, goalId: string | null): Promise<void> {
  if (!goalId) return;
  const goal = await ctx.repos.goals.findById(goalId);
  if (!goal || goal.learnerId !== learnerId) throw validationFailed('绑定的目标不存在');
}

async function validateParent(
  ctx: AppContext,
  learnerId: string,
  type: ScenarioType,
  parentId: string | null,
): Promise<void> {
  if (type === 'big') return;
  if (!parentId) throw validationFailed('小场景必须选择所属大场景');
  const parent = await ctx.repos.scenarios.findById(parentId);
  if (!parent || parent.learnerId !== learnerId || parent.type !== 'big') {
    throw validationFailed('所属大场景不存在');
  }
}
