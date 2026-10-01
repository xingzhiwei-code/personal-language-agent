import type {
  KnowledgeExample,
  KnowledgeItem,
  KnowledgeRelation,
  LearnerState,
} from '@/domain/entities';
import type {
  ContentOrigin,
  KnowledgeRelationType,
  KnowledgeStatus,
  KnowledgeType,
  SourceType,
} from '@/domain/enums';
import { notFound, validationFailed } from '@/domain/errors';
import { classifyKnowledgeText, normalizeKnowledgeText } from '@/language/registry';
import { createInitialState } from '@/learner/state';
import { appendEvent } from './events';
import type { AppContext } from './types';

export interface CreateKnowledgeInput {
  learnerId: string;
  text: string;
  languageCode?: string;
  type?: KnowledgeType;
  meaning?: string | null;
  notes?: string | null;
  examples?: KnowledgeExample[];
  tags?: string[];
  origin?: ContentOrigin;
  sourceType?: SourceType;
  sourceRef?: string | null;
  sourceId?: string | null;
  aiGenerated?: boolean;
}

export interface CreateKnowledgeResult {
  item: KnowledgeItem;
  /** True when an equivalent item already existed (same type + normalised text). */
  deduplicated: boolean;
}

/**
 * Adds a knowledge item. `figure` (word) and `figure out` (phrase) are
 * different items because de-duplication is scoped by type + normalised text
 * (PRD §F-07).
 *
 * Provenance is always recorded: AI-generated entries are flagged and can
 * never be mistaken for authentic material (PRD §8).
 */
export async function createKnowledgeItem(
  ctx: AppContext,
  input: CreateKnowledgeInput,
): Promise<CreateKnowledgeResult> {
  const text = input.text.trim();
  if (text.length === 0) throw validationFailed('内容不能为空');
  if (text.length > 400) throw validationFailed('内容太长，请拆分成更小的知识点');

  const languageCode = input.languageCode ?? 'en';
  const type = input.type ?? classifyKnowledgeText(languageCode, text);
  const normalizedText = normalizeKnowledgeText(languageCode, text);
  const now = ctx.clock.nowIso();

  const existing = await ctx.repos.knowledge.findByNormalized(
    input.learnerId,
    languageCode,
    type,
    normalizedText,
  );
  if (existing) {
    // Enrich instead of duplicating: fill in a missing meaning / new examples.
    const mergedExamples = mergeExamples(existing.examples, input.examples ?? []);
    const needsUpdate =
      (!existing.meaning && !!input.meaning) ||
      mergedExamples.length !== existing.examples.length ||
      existing.status !== 'active';
    if (needsUpdate) {
      const updated: KnowledgeItem = {
        ...existing,
        meaning: existing.meaning ?? input.meaning ?? null,
        examples: mergedExamples,
        status: existing.status === 'irrelevant' ? existing.status : 'active',
        updatedAt: now,
      };
      await ctx.repos.knowledge.update(updated);
      return { item: updated, deduplicated: true };
    }
    return { item: existing, deduplicated: true };
  }

  const origin = input.origin ?? (input.aiGenerated ? 'ai_generated' : 'user');
  const item: KnowledgeItem = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    languageCode,
    type,
    text,
    normalizedText,
    meaning: input.meaning?.trim() || null,
    notes: input.notes?.trim() || null,
    examples: input.examples ?? [],
    tags: input.tags ?? [],
    origin,
    sourceType: input.sourceType ?? (origin === 'ai_generated' ? 'ai_generated' : 'user_manual'),
    sourceId: input.sourceId ?? null,
    sourceRef: input.sourceRef ?? null,
    aiGenerated: input.aiGenerated ?? origin === 'ai_generated',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.knowledge.create(item);

  // A new item is immediately reviewable; mastery stays 0 until measured.
  const state = createInitialState({
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    subjectType: 'knowledge_item',
    subjectId: item.id,
    nowIso: now,
  });
  await ctx.repos.states.upsert({ ...state, nextReviewAt: now });

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'knowledge_added',
    source: input.aiGenerated ? 'agent' : 'user',
    idempotencyKey: `knowledge-added:${item.id}`,
    payload: {
      knowledgeItemId: item.id,
      type: item.type,
      origin: item.origin,
      aiGenerated: item.aiGenerated,
    },
  });

  return { item, deduplicated: false };
}

function mergeExamples(
  existing: KnowledgeExample[],
  incoming: KnowledgeExample[],
): KnowledgeExample[] {
  const seen = new Set(existing.map((example) => example.text.trim().toLowerCase()));
  const merged = [...existing];
  for (const example of incoming) {
    const key = example.text.trim().toLowerCase();
    if (key.length > 0 && !seen.has(key)) {
      seen.add(key);
      merged.push(example);
    }
  }
  return merged.slice(0, 20);
}

export interface UpdateKnowledgeInput {
  learnerId: string;
  id: string;
  text?: string;
  type?: KnowledgeType;
  meaning?: string | null;
  notes?: string | null;
  tags?: string[];
  status?: KnowledgeStatus;
  examples?: KnowledgeExample[];
}

export async function updateKnowledgeItem(
  ctx: AppContext,
  input: UpdateKnowledgeInput,
): Promise<KnowledgeItem> {
  const item = await ctx.repos.knowledge.findById(input.id);
  if (!item || item.learnerId !== input.learnerId) throw notFound('KnowledgeItem', input.id);

  const text = input.text?.trim() ?? item.text;
  if (text.length === 0) throw validationFailed('内容不能为空');
  const type = input.type ?? item.type;
  const now = ctx.clock.nowIso();
  const normalizedText = normalizeKnowledgeText(item.languageCode, text);

  if (normalizedText !== item.normalizedText || type !== item.type) {
    const clash = await ctx.repos.knowledge.findByNormalized(
      item.learnerId,
      item.languageCode,
      type,
      normalizedText,
    );
    if (clash && clash.id !== item.id) {
      throw validationFailed('已存在相同类型的同一条目', { existingId: clash.id });
    }
  }

  const updated: KnowledgeItem = {
    ...item,
    text,
    type,
    normalizedText,
    meaning: input.meaning === undefined ? item.meaning : input.meaning?.trim() || null,
    notes: input.notes === undefined ? item.notes : input.notes?.trim() || null,
    tags: input.tags ?? item.tags,
    examples: input.examples ?? item.examples,
    status: input.status ?? item.status,
    updatedAt: now,
  };
  await ctx.repos.knowledge.update(updated);

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'knowledge_updated',
    source: 'user',
    idempotencyKey: `knowledge-updated:${item.id}:${now}`,
    payload: { knowledgeItemId: item.id, status: updated.status },
  });

  return updated;
}

export async function deleteKnowledgeItem(
  ctx: AppContext,
  learnerId: string,
  id: string,
): Promise<void> {
  const item = await ctx.repos.knowledge.findById(id);
  if (!item || item.learnerId !== learnerId) throw notFound('KnowledgeItem', id);
  await ctx.repos.knowledge.delete(id);
  await appendEvent(ctx, {
    learnerId,
    type: 'knowledge_updated',
    source: 'user',
    idempotencyKey: `knowledge-deleted:${id}`,
    payload: { knowledgeItemId: id, deleted: true },
  });
}

export interface RelationInput {
  learnerId: string;
  fromItemId: string;
  toItemId: string;
  type: KnowledgeRelationType;
  note?: string | null;
}

export async function addKnowledgeRelation(
  ctx: AppContext,
  input: RelationInput,
): Promise<KnowledgeRelation> {
  if (input.fromItemId === input.toItemId) {
    throw validationFailed('不能与自身建立关系');
  }
  const [from, to] = await Promise.all([
    ctx.repos.knowledge.findById(input.fromItemId),
    ctx.repos.knowledge.findById(input.toItemId),
  ]);
  if (!from || from.learnerId !== input.learnerId) throw notFound('KnowledgeItem', input.fromItemId);
  if (!to || to.learnerId !== input.learnerId) throw notFound('KnowledgeItem', input.toItemId);

  const existing = await ctx.repos.relations.find(
    input.fromItemId,
    input.toItemId,
    input.type,
  );
  if (existing) return existing;

  const relation: KnowledgeRelation = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    fromItemId: input.fromItemId,
    toItemId: input.toItemId,
    type: input.type,
    note: input.note ?? null,
    createdAt: ctx.clock.nowIso(),
  };
  return ctx.repos.relations.create(relation);
}

export async function removeKnowledgeRelation(
  ctx: AppContext,
  learnerId: string,
  relationId: string,
): Promise<void> {
  const relations = await ctx.repos.relations.listByLearner(learnerId);
  const target = relations.find((relation) => relation.id === relationId);
  if (!target) throw notFound('KnowledgeRelation', relationId);
  await ctx.repos.relations.delete(relationId);
}

export interface KnowledgeDetail {
  item: KnowledgeItem;
  state: LearnerState | null;
  relations: { relation: KnowledgeRelation; other: KnowledgeItem; direction: 'out' | 'in' }[];
}

export async function getKnowledgeDetail(
  ctx: AppContext,
  learnerId: string,
  id: string,
): Promise<KnowledgeDetail> {
  const item = await ctx.repos.knowledge.findById(id);
  if (!item || item.learnerId !== learnerId) throw notFound('KnowledgeItem', id);

  const relations = await ctx.repos.relations.listByItem(id);
  const otherIds = relations.map((relation) =>
    relation.fromItemId === id ? relation.toItemId : relation.fromItemId,
  );
  const others = await ctx.repos.knowledge.listByIds(otherIds);
  const byId = new Map(others.map((other) => [other.id, other]));

  return {
    item,
    state: await ctx.repos.states.find(learnerId, 'knowledge_item', id),
    relations: relations
      .map((relation) => {
        const otherId = relation.fromItemId === id ? relation.toItemId : relation.fromItemId;
        const other = byId.get(otherId);
        return other
          ? {
              relation,
              other,
              direction: (relation.fromItemId === id ? 'out' : 'in') as 'out' | 'in',
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  };
}

export interface KnowledgeListResult {
  items: { item: KnowledgeItem; state: LearnerState | null }[];
  total: number;
}

export async function listKnowledge(
  ctx: AppContext,
  query: {
    learnerId: string;
    text?: string;
    types?: KnowledgeType[];
    statuses?: KnowledgeStatus[];
    limit?: number;
    offset?: number;
  },
): Promise<KnowledgeListResult> {
  const items = await ctx.repos.knowledge.search(query);
  const total = await ctx.repos.knowledge.count(query);
  const withStates: { item: KnowledgeItem; state: LearnerState | null }[] = [];
  for (const item of items) {
    withStates.push({
      item,
      state: await ctx.repos.states.find(query.learnerId, 'knowledge_item', item.id),
    });
  }
  return { items: withStates, total };
}
