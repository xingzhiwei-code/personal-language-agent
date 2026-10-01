import type { LearningPreference, Memory } from '@/domain/entities';
import type { MemoryKind } from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { appendEvent } from './events';
import type { AppContext } from './types';

/**
 * Memory rules (PRD §5.2):
 * - Event = what happened (append-only log).
 * - State = current estimate (learner model).
 * - Memory = information worth keeping for a long time.
 *
 * A single "今天不想背单词" must not become a permanent preference, so an
 * observed signal starts with low confidence and only becomes trustworthy
 * after repeated, independent observations.
 */

const EXPLICIT_CONFIDENCE = 0.7;
const OBSERVED_START_CONFIDENCE = 0.25;
const OBSERVED_GAIN = 0.3;
const MAX_CONFIDENCE = 0.95;

export interface SaveMemoryInput {
  learnerId: string;
  key: string;
  kind: MemoryKind;
  content: string;
  /** `user_explicit` memories are trusted immediately; observations are not. */
  source: 'user_explicit' | 'observed';
}

export async function saveMemory(ctx: AppContext, input: SaveMemoryInput): Promise<Memory> {
  const key = input.key.trim();
  const content = input.content.trim();
  if (key.length === 0 || content.length === 0) {
    throw validationFailed('记忆内容不能为空');
  }

  const now = ctx.clock.nowIso();
  const existing = await ctx.repos.memories.findByKey(input.learnerId, key);

  if (existing) {
    const confidence =
      input.source === 'user_explicit'
        ? Math.max(existing.confidence, EXPLICIT_CONFIDENCE)
        : Math.min(MAX_CONFIDENCE, existing.confidence + (1 - existing.confidence) * OBSERVED_GAIN);
    const updated: Memory = {
      ...existing,
      kind: input.kind,
      content,
      confidence: Math.round(confidence * 10000) / 10000,
      evidenceCount: existing.evidenceCount + 1,
      lastObservedAt: now,
      status: 'active',
      updatedAt: now,
    };
    return ctx.repos.memories.upsertByKey(updated);
  }

  const memory: Memory = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    kind: input.kind,
    key,
    content,
    confidence: input.source === 'user_explicit' ? EXPLICIT_CONFIDENCE : OBSERVED_START_CONFIDENCE,
    evidenceCount: 1,
    lastObservedAt: now,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  return ctx.repos.memories.upsertByKey(memory);
}

export async function listMemories(
  ctx: AppContext,
  learnerId: string,
  minConfidence = 0,
): Promise<Memory[]> {
  const memories = await ctx.repos.memories.listByLearner(learnerId, ['active']);
  return memories.filter((memory) => memory.confidence >= minConfidence);
}

/** The learner can always correct or delete what the system remembers. */
export async function retireMemory(
  ctx: AppContext,
  learnerId: string,
  memoryId: string,
): Promise<void> {
  const memories = await ctx.repos.memories.listByLearner(learnerId);
  const memory = memories.find((entry) => entry.id === memoryId);
  if (!memory) throw validationFailed('找不到这条记忆');
  await ctx.repos.memories.retire(memoryId, ctx.clock.nowIso());
  await appendEvent(ctx, {
    learnerId,
    type: 'user_feedback',
    source: 'user',
    idempotencyKey: `memory-retired:${memoryId}`,
    payload: { kind: 'memory_retired', memoryId },
  });
}

export interface SetPreferenceInput {
  learnerId: string;
  key: string;
  value: string;
  source: 'user_explicit' | 'inferred';
}

/**
 * Preferences are hypotheses with confidence and evidence, not permanent facts
 * (PRD §F-09).
 */
export async function setPreference(
  ctx: AppContext,
  input: SetPreferenceInput,
): Promise<LearningPreference> {
  const now = ctx.clock.nowIso();
  const existing = await ctx.repos.preferences.findByKey(input.learnerId, input.key);

  const confidence = existing
    ? input.source === 'user_explicit'
      ? Math.max(existing.confidence, EXPLICIT_CONFIDENCE)
      : Math.min(MAX_CONFIDENCE, existing.confidence + (1 - existing.confidence) * OBSERVED_GAIN)
    : input.source === 'user_explicit'
      ? EXPLICIT_CONFIDENCE
      : OBSERVED_START_CONFIDENCE;

  const preference: LearningPreference = {
    id: existing?.id ?? ctx.ids.next(),
    learnerId: input.learnerId,
    key: input.key,
    value: input.value,
    confidence: Math.round(confidence * 10000) / 10000,
    evidenceCount: (existing?.evidenceCount ?? 0) + 1,
    source: input.source,
    lastObservedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const saved = await ctx.repos.preferences.upsertByKey(preference);

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'preference_updated',
    source: input.source === 'user_explicit' ? 'user' : 'system',
    idempotencyKey: `preference:${input.key}:${now}`,
    payload: { key: input.key, value: input.value, confidence: saved.confidence },
  });

  return saved;
}

export async function deletePreference(
  ctx: AppContext,
  learnerId: string,
  key: string,
): Promise<void> {
  const existing = await ctx.repos.preferences.findByKey(learnerId, key);
  if (existing) await ctx.repos.preferences.delete(existing.id);
}
