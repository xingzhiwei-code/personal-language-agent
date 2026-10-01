import type { KnowledgeItem, LearnerState, Recommendation } from '@/domain/entities';
import type { ActivityType } from '@/domain/enums';
import { notFound } from '@/domain/errors';
import { overdueDays } from '@/learner/srs';
import { nextUsefulModality } from '@/learner/skills';
import { scoreCandidates } from '@/scheduler/scoring';
import type { DueReviewSummary, SchedulerSnapshot } from '@/scheduler/types';
import { getCurrentContext } from './context';
import { appendEvent } from './events';
import type { AppContext } from './types';

const REJECTION_TTL_MS = 60 * 60 * 1000;
const MAX_POOL = 400;

export interface ReviewCandidate {
  item: KnowledgeItem;
  state: LearnerState;
  overdueDays: number;
}

export interface SnapshotBundle {
  snapshot: SchedulerSnapshot;
  dueCandidates: ReviewCandidate[];
  practicePool: { item: KnowledgeItem; state: LearnerState | null }[];
}

/**
 * Gathers everything the deterministic scheduler needs. Reading state is cheap
 * and local; no AI call happens anywhere in this path (PRD §F-01 acceptance).
 */
export async function buildSchedulerSnapshot(
  ctx: AppContext,
  learnerId: string,
): Promise<SnapshotBundle> {
  const now = ctx.clock.nowIso();

  const goal = await ctx.repos.goals.findPrimary(learnerId);
  const targets = goal ? await ctx.repos.targets.listByGoal(goal.id) : [];
  const skillStates = await ctx.repos.states.listBySubjectType(learnerId, 'skill');

  const dueStates = await ctx.repos.states.listDueForReview(learnerId, now, 60);
  const dueItems = await ctx.repos.knowledge.listByIds(
    dueStates.map((state) => state.subjectId),
  );
  const dueItemById = new Map(dueItems.map((item) => [item.id, item]));

  const dueCandidates: ReviewCandidate[] = dueStates
    .map((state) => {
      const item = dueItemById.get(state.subjectId);
      if (!item || item.status !== 'active') return null;
      return { item, state, overdueDays: overdueDays(state.nextReviewAt, now) };
    })
    .filter((entry): entry is ReviewCandidate => entry !== null);

  const activeItems = await ctx.repos.knowledge.search({
    learnerId,
    statuses: ['active'],
    limit: MAX_POOL,
  });
  const practicePool: { item: KnowledgeItem; state: LearnerState | null }[] = [];
  for (const item of activeItems) {
    practicePool.push({
      item,
      state: await ctx.repos.states.find(learnerId, 'knowledge_item', item.id),
    });
  }

  const dueReviews: DueReviewSummary[] = dueCandidates.map((candidate) => ({
    subjectId: candidate.item.id,
    mastery: candidate.state.mastery,
    overdueDays: candidate.overdueDays,
    suggestedModality: nextUsefulModality(candidate.state),
  }));

  const recentRecommendations = await ctx.repos.recommendations.listRecent(learnerId, 10);
  const rejectedActivityTypes = recentRecommendations
    .filter(
      (recommendation) =>
        recommendation.status === 'rejected' &&
        Date.parse(now) - Date.parse(recommendation.generatedAt) <= REJECTION_TTL_MS,
    )
    .map((recommendation) => recommendation.activityType);

  const snapshot: SchedulerSnapshot = {
    nowIso: now,
    goal: goal
      ? {
          id: goal.id,
          languageCode: goal.languageCode,
          title: goal.title,
          priority: goal.priority,
        }
      : null,
    targets: targets.map((target) => ({ skill: target.skill, importance: target.importance })),
    skillStates,
    dueReviews,
    knowledgeCount: activeItems.length,
    sentenceCount: activeItems.filter(
      (item) => item.examples.length > 0 || item.type === 'sentence',
    ).length,
    grammarItemCount: activeItems.filter(
      (item) => item.type === 'grammar' || item.type === 'pattern',
    ).length,
    context: await getCurrentContext(ctx, learnerId),
    preferences: await ctx.repos.preferences.listByLearner(learnerId),
    recentActivityTypes: await ctx.repos.sessions.listRecentActivityTypes(learnerId, 5),
    aiAvailable: ctx.llm.isConfigured(),
    rejectedActivityTypes,
  };

  return { snapshot, dueCandidates, practicePool };
}

export interface RecommendationBundle {
  recommendations: Recommendation[];
  snapshot: SchedulerSnapshot;
  dueCandidates: ReviewCandidate[];
}

/** Produces and persists ranked recommendations. Deterministic and explainable. */
export async function generateRecommendations(
  ctx: AppContext,
  learnerId: string,
  limit = 3,
): Promise<RecommendationBundle> {
  const { snapshot, dueCandidates } = await buildSchedulerSnapshot(ctx, learnerId);
  const scored = scoreCandidates(snapshot).slice(0, limit);
  const now = ctx.clock.nowIso();
  const goalId = snapshot.goal?.id ?? null;

  const recommendations: Recommendation[] = scored.map((candidate) => ({
    id: ctx.ids.next(),
    learnerId,
    goalId,
    activityType: candidate.activityType,
    score: candidate.score,
    reason: candidate.reason,
    factors: candidate.factors,
    subjectIds: candidate.subjectIds,
    plannedDurationMinutes: candidate.plannedDurationMinutes,
    estimatedItemCount: candidate.estimatedItemCount,
    status: 'offered',
    requiresAi: candidate.requiresAi,
    generatedAt: now,
  }));

  if (recommendations.length > 0) {
    await ctx.repos.recommendations.createMany(recommendations);
    await appendEvent(ctx, {
      learnerId,
      type: 'recommendation_offered',
      source: 'system',
      idempotencyKey: `recommendation-offered:${recommendations[0]!.id}`,
      payload: {
        recommendationIds: recommendations.map((recommendation) => recommendation.id),
        top: recommendations[0]!.activityType,
        score: recommendations[0]!.score,
      },
    });
  }

  return { recommendations, snapshot, dueCandidates };
}

export async function markRecommendationAccepted(
  ctx: AppContext,
  learnerId: string,
  recommendationId: string,
): Promise<void> {
  const recommendation = await ctx.repos.recommendations.findById(recommendationId);
  if (!recommendation || recommendation.learnerId !== learnerId) return;
  await ctx.repos.recommendations.update({ ...recommendation, status: 'accepted' });
  await appendEvent(ctx, {
    learnerId,
    type: 'recommendation_accepted',
    source: 'user',
    idempotencyKey: `recommendation-accepted:${recommendationId}`,
    payload: { recommendationId, activityType: recommendation.activityType },
  });
}

/**
 * A rejection is feedback about *this* suggestion, not a permanent dislike.
 * It suppresses the activity type for an hour and is recorded as an event;
 * it does not write a long-term preference (PRD §F-01 / §5.2).
 */
export async function rejectRecommendation(
  ctx: AppContext,
  learnerId: string,
  recommendationId: string,
): Promise<Recommendation> {
  const recommendation = await ctx.repos.recommendations.findById(recommendationId);
  if (!recommendation || recommendation.learnerId !== learnerId) {
    throw notFound('Recommendation', recommendationId);
  }
  const updated: Recommendation = { ...recommendation, status: 'rejected' };
  await ctx.repos.recommendations.update(updated);
  await appendEvent(ctx, {
    learnerId,
    type: 'recommendation_rejected',
    source: 'user',
    idempotencyKey: `recommendation-rejected:${recommendationId}`,
    payload: { recommendationId, activityType: recommendation.activityType },
  });
  return updated;
}

export function activityLabel(activityType: ActivityType): string {
  const labels: Record<ActivityType, string> = {
    quick_review: '快速复习',
    vocabulary_recall: '词汇回忆',
    reading: '阅读练习',
    listening: '听力练习',
    conversation: '自由对话',
    grammar_practice: '语法练习',
    writing: '写作练习',
    pronunciation: '发音练习',
  };
  return labels[activityType];
}
