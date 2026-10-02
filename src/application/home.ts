import type {
  Goal,
  LearnerState,
  LearningSession,
  LearningTarget,
  Recommendation,
  UserContext,
} from '@/domain/entities';
import type { SkillKind, Trend } from '@/domain/enums';
import { getCurrentContext } from './context';
import { isRestingToday } from './daily-plan';
import { ensureLearner } from './goals';
import { generateRecommendations } from './recommendations';
import { findResumableSession } from './sessions';
import type { AppContext } from './types';

export interface SkillSnapshot {
  skill: SkillKind;
  mastery: number;
  confidence: number;
  trend: Trend;
  importance: number;
  /** Measured modality strengths — only what we actually observed. */
  recognition: number | null;
  recall: number | null;
  production: number | null;
}

export interface HomeView {
  hasGoal: boolean;
  goal: Goal | null;
  targets: LearningTarget[];
  primary: Recommendation | null;
  alternatives: Recommendation[];
  resumable: LearningSession | null;
  context: UserContext | null;
  aiAvailable: boolean;
  restingToday: boolean;
  stats: {
    dueCount: number;
    knowledgeCount: number;
    sessionsLast7Days: number;
    answersLast7Days: number;
    /** Total knowledge items with at least one measurement. */
    measuredItems: number;
  };
  skills: SkillSnapshot[];
}

const RECOMMENDATION_REUSE_MS = 10 * 60 * 1000;

/**
 * Reuses the latest offered recommendation set unless something happened since
 * it was generated. This keeps the home screen instant, avoids writing a new
 * row on every render, and still guarantees the PRD requirement that the next
 * recommendation reflects the last activity.
 */
async function getOrCreateRecommendations(
  ctx: AppContext,
  learnerId: string,
): Promise<Recommendation[]> {
  const now = Date.parse(ctx.clock.nowIso());
  const recent = await ctx.repos.recommendations.listRecent(learnerId, 6);
  const offered = recent.filter((recommendation) => recommendation.status === 'offered');

  if (offered.length > 0) {
    const generatedAt = Date.parse(offered[0]!.generatedAt);
    const fresh = now - generatedAt <= RECOMMENDATION_REUSE_MS;
    if (fresh) {
      const [lastEvent] = await ctx.repos.events.listByLearner(learnerId, 1);
      const unchanged = !lastEvent || Date.parse(lastEvent.occurredAt) <= generatedAt;
      if (unchanged) {
        return offered
          .filter((recommendation) => recommendation.generatedAt === offered[0]!.generatedAt)
          .sort((a, b) => b.score - a.score);
      }
    }
  }

  const { recommendations } = await generateRecommendations(ctx, learnerId, 3);
  return recommendations;
}

export async function getHomeView(ctx: AppContext, learnerId: string): Promise<HomeView> {
  await ensureLearner(ctx);

  const goal = await ctx.repos.goals.findPrimary(learnerId);
  const targets = goal ? await ctx.repos.targets.listByGoal(goal.id) : [];
  const restingToday = await isRestingToday(ctx, learnerId);
  const recommendations = goal && !restingToday ? await getOrCreateRecommendations(ctx, learnerId) : [];

  const now = ctx.clock.nowIso();
  const sevenDaysAgo = new Date(Date.parse(now) - 7 * 86_400_000).toISOString();
  const recentEvents = await ctx.repos.events.listSince(learnerId, sevenDaysAgo);

  const dueStates = await ctx.repos.states.listDueForReview(learnerId, now, 200);
  const knowledgeCount = await ctx.repos.knowledge.count({
    learnerId,
    statuses: ['active'],
  });
  const knowledgeStates = await ctx.repos.states.listBySubjectType(
    learnerId,
    'knowledge_item',
  );
  const skillStates = await ctx.repos.states.listBySubjectType(learnerId, 'skill');

  return {
    hasGoal: !!goal,
    goal,
    targets,
    primary: recommendations[0] ?? null,
    alternatives: recommendations.slice(1),
    resumable: await findResumableSession(ctx, learnerId),
    context: await getCurrentContext(ctx, learnerId),
    aiAvailable: ctx.llm.isConfigured(),
    restingToday,
    stats: {
      dueCount: dueStates.length,
      knowledgeCount,
      sessionsLast7Days: recentEvents.filter((event) => event.type === 'session_started').length,
      answersLast7Days: recentEvents.filter((event) => event.type === 'assessment_recorded')
        .length,
      measuredItems: knowledgeStates.filter((state) => state.exposureCount > 0).length,
    },
    skills: buildSkillSnapshots(targets, skillStates),
  };
}

export function buildSkillSnapshots(
  targets: LearningTarget[],
  skillStates: LearnerState[],
): SkillSnapshot[] {
  const bySkill = new Map(skillStates.map((state) => [state.subjectId, state]));
  return targets
    .map((target) => {
      const state = bySkill.get(target.skill);
      return {
        skill: target.skill,
        mastery: state?.mastery ?? 0,
        confidence: state?.confidence ?? 0,
        trend: state?.trend ?? ('unknown' as Trend),
        importance: target.importance,
        recognition: state?.modalityStats.recognition?.strength ?? null,
        recall: state?.modalityStats.recall?.strength ?? null,
        production: state?.modalityStats.production?.strength ?? null,
      };
    })
    .sort((a, b) => b.importance - a.importance || a.mastery - b.mastery);
}
