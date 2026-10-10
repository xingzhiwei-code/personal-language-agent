import type { WordRelation } from '@/domain/entities';
import { localDayKey } from './local-day';
import type { AppContext } from './types';

/**
 * v0.4 §G3 — daily-one-topic rotation.
 *
 * The topic advances once per *learning day* (a distinct natural day with at
 * least one completed non-placement session), NOT per calendar day. Skipping
 * days never resets the rotation: you come back and continue from the next
 * topic (断更续接).
 */

/**
 * Pure rotation: returns the topic for the current learning day, given the
 * number of completed learning days so far. Testable in isolation.
 */
export function topicForLearningDay(
  topicSequence: readonly string[],
  completedDayCount: number,
): string | null {
  if (topicSequence.length === 0) return null;
  const safe = Math.max(0, completedDayCount);
  return topicSequence[safe % topicSequence.length] ?? null;
}

/**
 * Number of distinct natural days with a completed non-placement session that
 * are STRICTLY BEFORE today. Today's own completions must not advance the topic
 * mid-day: the topic is assigned when the day's plan is first generated.
 */
export async function countLearningDays(ctx: AppContext, learnerId: string): Promise<number> {
  const completed = await ctx.repos.sessions.listByLearner(learnerId, 2000, ['completed']);
  const todayKey = localDayKey(ctx.clock.nowIso());
  const priorDayKeys = new Set(
    completed
      .filter((session) => session.activityType !== 'placement')
      .map((session) => localDayKey(session.endedAt ?? session.updatedAt))
      .filter((key) => key < todayKey),
  );
  return priorDayKeys.size;
}

/**
 * Today's topic from the primary goal's active phase. Null when the goal has no
 * phases yet (未校准) — the scheduler then falls back to the v0.3 logic.
 */
export async function getCurrentTopic(ctx: AppContext, learnerId: string): Promise<string | null> {
  const goal = await ctx.repos.goals.findPrimary(learnerId);
  if (!goal) return null;
  const phase = await ctx.repos.goalPhases.findActiveByGoal(goal.id);
  if (!phase || phase.topicSequence.length === 0) return null;
  const completedDays = await countLearningDays(ctx, learnerId);
  return topicForLearningDay(phase.topicSequence, completedDays);
}

/** Lemmas belonging to a topic (from `word_relations`), deduplicated. */
export async function getTopicLemmas(ctx: AppContext, topic: string): Promise<string[]> {
  const relations = await ctx.repos.wordRelations.listByTopic(topic);
  return [...new Set(relations.map((relation) => relation.wordLemma))];
}

/**
 * Relations for a batch of lemmas, keyed by lemma. Used for card labels and
 * within-group ordering. Only synonym / antonym / word_family are exposed —
 * `topic` rows are the selection signal, not a card label.
 */
export async function getLemmaRelations(
  ctx: AppContext,
  lemmas: readonly string[],
): Promise<Map<string, WordRelation[]>> {
  const relations = await ctx.repos.wordRelations.listByLemmas([...lemmas]);
  const byLemma = new Map<string, WordRelation[]>();
  for (const relation of relations) {
    if (relation.relationType === 'topic') continue;
    const bucket = byLemma.get(relation.wordLemma) ?? [];
    bucket.push(relation);
    byLemma.set(relation.wordLemma, bucket);
  }
  return byLemma;
}

/** Normalises an item's surface form to a lemma for relation lookup. */
export function lemmaOf(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
