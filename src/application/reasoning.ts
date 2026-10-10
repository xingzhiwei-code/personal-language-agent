import type { Recommendation } from '@/domain/entities';
import type { GoalType } from '@/domain/enums';
import { previousDayKey } from './streak';
import { localDayKey } from './local-day';
import { getCurrentTopic, getTopicLemmas, lemmaOf } from './topic';
import type { AppContext } from './types';

/**
 * v0.4 §G4 — the startup card's one-line explanation, upgraded from "where the
 * words come from" to "why these words today". Fully deterministic string
 * concatenation (no LLM). Every clause is present only when its data exists;
 * nothing is fabricated (red line "缺数据不编造").
 *
 * Template: `[阶段定位] · [承上] · [缺口]`
 */

const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  ielts: '雅思备考',
  general: '综合英语',
};

export async function buildStartupReason(
  ctx: AppContext,
  learnerId: string,
  recommendation: Recommendation,
): Promise<string> {
  // 阶段定位 requires a calibrated phase. Without it, fall back to the v0.3
  // wording (never invent a phase).
  const goal = await ctx.repos.goals.findPrimary(learnerId);
  const phase = goal ? await ctx.repos.goalPhases.findActiveByGoal(goal.id) : null;
  if (!goal || !phase) return recommendation.reason;

  const parts: string[] = [];
  parts.push(
    `${GOAL_TYPE_LABEL[goal.goalType]} · 第${phase.seq}阶段（${phase.name}）`,
  );

  const yesterday = await buildYesterdayClause(ctx, learnerId);
  if (yesterday) parts.push(yesterday);

  const gap = await buildGapClause(ctx, learnerId);
  if (gap) parts.push(gap);

  return parts.join(' · ');
}

/** 承上: what the learner actually studied yesterday (words only). */
async function buildYesterdayClause(ctx: AppContext, learnerId: string): Promise<string | null> {
  const completed = await ctx.repos.sessions.listByLearner(learnerId, 200, ['completed']);
  const yesterdayKey = previousDayKey(localDayKey(ctx.clock.nowIso()));
  const yesterdaySessions = completed.filter(
    (session) =>
      session.activityType !== 'placement' &&
      localDayKey(session.endedAt ?? session.updatedAt) === yesterdayKey,
  );
  if (yesterdaySessions.length === 0) return null;

  const itemIds = [
    ...new Set(yesterdaySessions.flatMap((session) => session.summary?.knowledgeItemIds ?? [])),
  ];
  if (itemIds.length === 0) return null;
  const items = await ctx.repos.knowledge.listByIds(itemIds.slice(0, 20));
  const words = items.map((item) => item.text).slice(0, 3);
  if (words.length === 0) return null;
  return `昨天学了 ${words.join('、')}`;
}

/** 缺口: today's-topic writing accuracy, only when the data actually exists. */
async function buildGapClause(ctx: AppContext, learnerId: string): Promise<string | null> {
  const topic = await getCurrentTopic(ctx, learnerId);
  if (!topic) return null;
  const topicLemmas = new Set((await getTopicLemmas(ctx, topic)).map(lemmaOf));
  if (topicLemmas.size === 0) return null;

  const items = await ctx.repos.knowledge.search({
    learnerId,
    statuses: ['active', 'user_mastered'],
    limit: 20_000,
  });
  const topicItemIds = items
    .filter((item) => topicLemmas.has(lemmaOf(item.text)))
    .map((item) => item.id);
  if (topicItemIds.length === 0) return null;

  const idSet = new Set(topicItemIds);
  const assessments = await ctx.repos.assessments.listByLearner(learnerId, 500);
  const writing = assessments.filter(
    (assessment) => assessment.modality === 'production' && idSet.has(assessment.subjectId),
  );
  if (writing.length < 3) return null;

  const accuracy = writing.filter((assessment) => assessment.correct).length / writing.length;
  if (accuracy >= 0.7) return null;
  return `你写作「${topic}」话题正确率 ${Math.round(accuracy * 100)}%，这组词先补这块`;
}
