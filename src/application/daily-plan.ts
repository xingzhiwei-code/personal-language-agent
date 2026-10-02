import type { Recommendation } from '@/domain/entities';
import { validationFailed } from '@/domain/errors';
import { appendEvent } from './events';
import { localDayKey } from './local-day';
import { deletePreference, setPreference } from './memory';
import { generateRecommendations, rejectRecommendation } from './recommendations';
import type { AppContext } from './types';

export const DAILY_PLAN_REST_KEY = 'daily_plan_rest_date';

export async function isRestingToday(ctx: AppContext, learnerId: string): Promise<boolean> {
  const preference = await ctx.repos.preferences.findByKey(learnerId, DAILY_PLAN_REST_KEY);
  return preference?.value === localDayKey(ctx.clock.nowIso());
}

export async function restDailyPlan(ctx: AppContext, learnerId: string): Promise<void> {
  const now = ctx.clock.nowIso();
  await setPreference(ctx, {
    learnerId,
    key: DAILY_PLAN_REST_KEY,
    value: localDayKey(now),
    source: 'user_explicit',
  });
  await ctx.repos.recommendations.expireOffered(
    learnerId,
    new Date(Date.parse(now) + 1).toISOString(),
  );
}

export async function resumeDailyPlan(ctx: AppContext, learnerId: string): Promise<void> {
  await deletePreference(ctx, learnerId, DAILY_PLAN_REST_KEY);
  const now = ctx.clock.nowIso();
  await appendEvent(ctx, {
    learnerId,
    type: 'preference_updated',
    source: 'user',
    idempotencyKey: `daily-plan-resumed:${now}`,
    payload: { key: DAILY_PLAN_REST_KEY, value: null },
  });
}

/** Rejects one complete offered batch and deterministically generates other activity types. */
export async function replaceDailyPlan(
  ctx: AppContext,
  learnerId: string,
  recommendationIds: string[],
): Promise<Recommendation[]> {
  const ids = [...new Set(recommendationIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 6) throw validationFailed('今日计划批次无效');
  const recommendations = await Promise.all(
    ids.map((id) => ctx.repos.recommendations.findById(id)),
  );
  if (
    recommendations.some(
      (recommendation) =>
        !recommendation ||
        recommendation.learnerId !== learnerId ||
        recommendation.status !== 'offered',
    )
  ) {
    throw validationFailed('今日计划已经变化，请刷新后再试');
  }
  const valid = recommendations.filter(
    (recommendation): recommendation is Recommendation => recommendation !== null,
  );
  const generatedAt = valid[0]!.generatedAt;
  if (valid.some((recommendation) => recommendation.generatedAt !== generatedAt)) {
    throw validationFailed('请选择同一批今日计划');
  }
  for (const recommendation of valid) {
    await rejectRecommendation(ctx, learnerId, recommendation.id);
  }
  const excludedSubjectIds = [...new Set(valid.flatMap((recommendation) => recommendation.subjectIds))];
  const excludedActivityTypes = [
    ...new Set(
      valid
        .filter((recommendation) => recommendation.subjectIds.length === 0)
        .map((recommendation) => recommendation.activityType),
    ),
  ];
  const next = await generateRecommendations(ctx, learnerId, 3, {
    excludedActivityTypes,
    excludedSubjectIds,
  });
  return next.recommendations;
}
