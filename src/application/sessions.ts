import type {
  Assessment,
  KnowledgeItem,
  LearnerState,
  LearningActivity,
  LearningSession,
  SessionSummary,
} from '@/domain/entities';
import type { ActivityType, SessionStatus } from '@/domain/enums';
import { notFound, validationFailed } from '@/domain/errors';
import { assertTransition, isResumable, isTerminal } from '@/domain/session-rules';
import {
  gradeChoice,
  gradeTextAnswer,
  scoreFromSelfRating,
  type GradeResult,
  type SelfRating,
} from '@/assessment/grading';
import { buildReviewItems, type ReviewItemSpec } from '@/assessment/review-items';
import { submitAssessment } from './assessment';
import { appendEvent } from './events';
import { buildSchedulerSnapshot, markRecommendationAccepted } from './recommendations';
import type { AppContext } from './types';

export interface StartSessionInput {
  learnerId: string;
  activityType: ActivityType;
  plannedDurationMinutes?: number | null;
  goalId?: string | null;
  recommendationId?: string | null;
  /** Idempotency token from the UI: double clicks must not create two sessions. */
  clientToken: string;
  correctionEnabled?: boolean;
  itemLimit?: number;
}

export interface SessionView {
  session: LearningSession;
  activities: LearningActivity[];
  nextActivity: LearningActivity | null;
  progress: { answered: number; skipped: number; total: number };
  knowledgeById: Record<string, KnowledgeItem>;
}

const ITEMS_PER_MINUTE: Record<ActivityType, number> = {
  quick_review: 2,
  vocabulary_recall: 1.5,
  reading: 1,
  grammar_practice: 1.2,
  writing: 0.5,
  conversation: 0,
  listening: 0,
  pronunciation: 0,
};

export async function startSession(
  ctx: AppContext,
  input: StartSessionInput,
): Promise<{ session: LearningSession; activities: LearningActivity[]; created: boolean }> {
  if (input.clientToken.trim().length === 0) {
    throw validationFailed('clientToken is required for idempotent session creation');
  }

  const existing = await ctx.repos.sessions.findByClientToken(
    input.learnerId,
    input.clientToken,
  );
  if (existing) {
    return {
      session: existing,
      activities: await ctx.repos.activities.listBySession(existing.id),
      created: false,
    };
  }

  const now = ctx.clock.nowIso();
  const goalId =
    input.goalId ?? (await ctx.repos.goals.findPrimary(input.learnerId))?.id ?? null;

  const session: LearningSession = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    goalId,
    recommendationId: input.recommendationId ?? null,
    activityType: input.activityType,
    status: 'active',
    plannedDurationMinutes: input.plannedDurationMinutes ?? null,
    correctionEnabled: input.correctionEnabled ?? true,
    startedAt: now,
    lastActiveAt: now,
    pausedAt: null,
    endedAt: null,
    summary: null,
    clientToken: input.clientToken,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.sessions.create(session);

  const itemLimit =
    input.itemLimit ??
    Math.max(
      1,
      Math.round(
        (input.plannedDurationMinutes ?? 5) * (ITEMS_PER_MINUTE[input.activityType] || 0),
      ),
    );

  const specs = await planActivities(ctx, input.learnerId, input.activityType, itemLimit);
  const activities: LearningActivity[] = specs.map((spec, index) => ({
    id: ctx.ids.next(),
    sessionId: session.id,
    learnerId: input.learnerId,
    position: index,
    kind: spec.kind,
    modality: spec.modality,
    subjectType: 'knowledge_item',
    subjectId: spec.subjectId,
    prompt: spec.prompt,
    options: spec.options,
    expectedAnswer: spec.expectedAnswer,
    hint: spec.hint,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }));
  await ctx.repos.activities.createMany(activities);

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'session_started',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `session-started:${session.id}`,
    payload: {
      activityType: input.activityType,
      plannedDurationMinutes: session.plannedDurationMinutes,
      itemCount: activities.length,
    },
  });

  if (input.recommendationId) {
    await markRecommendationAccepted(ctx, input.learnerId, input.recommendationId);
  }

  return { session, activities, created: true };
}

/** Chooses the concrete items for an activity type — deterministic selection. */
async function planActivities(
  ctx: AppContext,
  learnerId: string,
  activityType: ActivityType,
  itemLimit: number,
): Promise<ReviewItemSpec[]> {
  if (activityType === 'conversation' || activityType === 'listening' || activityType === 'pronunciation') {
    return [];
  }

  const { dueCandidates, practicePool } = await buildSchedulerSnapshot(ctx, learnerId);
  const distractorPool = practicePool.map((entry) => entry.item);

  let entries: { item: KnowledgeItem; state: LearnerState | null }[];
  switch (activityType) {
    case 'quick_review':
      entries = dueCandidates.map((candidate) => ({
        item: candidate.item,
        state: candidate.state,
      }));
      if (entries.length === 0) {
        entries = [...practicePool].sort(
          (a, b) => (a.state?.mastery ?? 0) - (b.state?.mastery ?? 0),
        );
      }
      break;
    case 'vocabulary_recall':
      entries = [...practicePool]
        .filter((entry) => entry.item.type === 'word' || entry.item.type === 'phrase' || entry.item.type === 'chunk')
        .sort((a, b) => (a.state?.mastery ?? 0) - (b.state?.mastery ?? 0));
      break;
    case 'reading':
      entries = practicePool.filter(
        (entry) => entry.item.examples.length > 0 || entry.item.type === 'sentence',
      );
      break;
    case 'grammar_practice':
      entries = practicePool.filter(
        (entry) => entry.item.type === 'grammar' || entry.item.type === 'pattern',
      );
      break;
    case 'writing':
      entries = [...practicePool].sort(
        (a, b) => (a.state?.mastery ?? 0) - (b.state?.mastery ?? 0),
      );
      break;
    default:
      entries = practicePool;
  }

  if (activityType === 'writing') {
    // Production practice: use the expression in a sentence of your own.
    return entries.slice(0, itemLimit).map((entry) => ({
      kind: 'writing_prompt' as const,
      modality: 'production' as const,
      subjectId: entry.item.id,
      prompt: `用「${entry.item.text}」写一个跟你自己相关的句子`,
      options: null,
      expectedAnswer: entry.item.text,
      hint: entry.item.meaning,
    }));
  }

  return buildReviewItems({
    entries: entries.slice(0, Math.max(itemLimit, 1)),
    distractorPool,
    limit: itemLimit,
    // Stable per learner+day so a reload does not reshuffle the question set.
    seed: hashSeed(`${learnerId}:${ctx.clock.nowIso().slice(0, 10)}:${activityType}`),
  });
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function getSessionView(
  ctx: AppContext,
  learnerId: string,
  sessionId: string,
): Promise<SessionView> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session || session.learnerId !== learnerId) throw notFound('LearningSession', sessionId);

  const activities = await ctx.repos.activities.listBySession(sessionId);
  const items = await ctx.repos.knowledge.listByIds(
    activities.map((activity) => activity.subjectId),
  );

  return {
    session,
    activities,
    nextActivity: activities.find((activity) => activity.status === 'pending') ?? null,
    progress: {
      answered: activities.filter((activity) => activity.status === 'answered').length,
      skipped: activities.filter((activity) => activity.status === 'skipped').length,
      total: activities.length,
    },
    knowledgeById: Object.fromEntries(items.map((item) => [item.id, item])),
  };
}

export interface SubmitAnswerInput {
  learnerId: string;
  sessionId: string;
  activityId: string;
  answer?: string | null;
  selfRating?: SelfRating | null;
  responseTimeMs?: number | null;
}

export interface SubmitAnswerResult {
  grade: GradeResult | null;
  score: number;
  assessment: Assessment | null;
  state: LearnerState | null;
  view: SessionView;
  /** True when this exact activity had already been answered. */
  duplicate: boolean;
}

/**
 * The vertical slice: answer -> deterministic grade -> Assessment -> Event ->
 * LearnerState -> next recommendation changes. Safe to retry.
 */
export async function submitActivityAnswer(
  ctx: AppContext,
  input: SubmitAnswerInput,
): Promise<SubmitAnswerResult> {
  const session = await ctx.repos.sessions.findById(input.sessionId);
  if (!session || session.learnerId !== input.learnerId) {
    throw notFound('LearningSession', input.sessionId);
  }
  if (isTerminal(session.status)) {
    // Do not lose the user's work silently; report clearly instead.
    throw validationFailed('这个学习会话已经结束了，可以从首页开始新的一次');
  }

  const activity = await ctx.repos.activities.findById(input.activityId);
  if (!activity || activity.sessionId !== session.id) {
    throw notFound('LearningActivity', input.activityId);
  }

  if (activity.status !== 'pending') {
    return {
      grade: null,
      score: 0,
      assessment: null,
      state: null,
      view: await getSessionView(ctx, input.learnerId, session.id),
      duplicate: true,
    };
  }

  const item = await ctx.repos.knowledge.findById(activity.subjectId);
  const languageCode = item?.languageCode ?? 'en';

  let grade: GradeResult | null = null;
  let score: number;
  if (activity.expectedAnswer && activity.options && activity.options.length > 0) {
    grade = gradeChoice(activity.expectedAnswer, input.answer ?? '');
    score = grade.score;
  } else if (activity.expectedAnswer && activity.kind === 'writing_prompt') {
    // Production: did the learner actually use the target expression?
    const used = (input.answer ?? '')
      .toLowerCase()
      .includes(activity.expectedAnswer.toLowerCase());
    const longEnough = (input.answer ?? '').trim().split(/\s+/).length >= 3;
    score = used ? (longEnough ? 1 : 0.7) : 0;
    grade = {
      score,
      verdict: used ? 'exact' : 'wrong',
      normalizedExpected: activity.expectedAnswer,
      normalizedActual: (input.answer ?? '').trim(),
    };
  } else if (activity.expectedAnswer) {
    grade = gradeTextAnswer(languageCode, activity.expectedAnswer, input.answer ?? '');
    score = grade.score;
  } else if (input.selfRating) {
    score = scoreFromSelfRating(input.selfRating);
  } else {
    throw validationFailed('请填写答案或选择自评');
  }

  const assessmentResult = await submitAssessment(ctx, {
    learnerId: input.learnerId,
    subjectType: 'knowledge_item',
    subjectId: activity.subjectId,
    modality: activity.modality,
    score,
    sessionId: session.id,
    activityId: activity.id,
    activityType: session.activityType,
    responseTimeMs: input.responseTimeMs ?? null,
    userAnswer: input.answer ?? input.selfRating ?? null,
    expectedAnswer: activity.expectedAnswer,
    source: 'user',
    // Stable key: one activity can only ever produce one assessment.
    idempotencyKey: `activity-answer:${activity.id}`,
  });

  const now = ctx.clock.nowIso();
  await ctx.repos.activities.update({ ...activity, status: 'answered', updatedAt: now });
  await ctx.repos.sessions.update({
    ...session,
    status: session.status === 'created' ? 'active' : session.status,
    lastActiveAt: now,
    updatedAt: now,
  });

  // NOTE: the session is intentionally NOT completed here. Completing it would
  // re-render the page into the summary and the learner would never see the
  // feedback for their last answer. `getSessionView` + the learn page complete
  // it when the learner moves on (completion is idempotent).

  return {
    grade,
    score,
    assessment: assessmentResult.assessment,
    state: assessmentResult.state,
    view: await getSessionView(ctx, input.learnerId, session.id),
    duplicate: false,
  };
}

/** Skipping is not failure and produces no negative evidence. */
export async function skipActivity(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string; activityId: string },
): Promise<SessionView> {
  const activity = await ctx.repos.activities.findById(input.activityId);
  if (!activity || activity.sessionId !== input.sessionId) {
    throw notFound('LearningActivity', input.activityId);
  }
  const now = ctx.clock.nowIso();
  if (activity.status === 'pending') {
    await ctx.repos.activities.update({ ...activity, status: 'skipped', updatedAt: now });
    await appendEvent(ctx, {
      learnerId: input.learnerId,
      type: 'activity_skipped',
      source: 'user',
      sessionId: input.sessionId,
      idempotencyKey: `activity-skipped:${activity.id}`,
      payload: { activityId: activity.id, subjectId: activity.subjectId },
    });
  }

  const remaining = await ctx.repos.activities.findNextPending(input.sessionId);
  if (!remaining) {
    await completeSession(ctx, { learnerId: input.learnerId, sessionId: input.sessionId });
  }
  return getSessionView(ctx, input.learnerId, input.sessionId);
}

async function transitionSession(
  ctx: AppContext,
  learnerId: string,
  sessionId: string,
  to: SessionStatus,
  extra: Partial<LearningSession> = {},
): Promise<LearningSession> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session || session.learnerId !== learnerId) throw notFound('LearningSession', sessionId);
  if (session.status === to) return session; // idempotent

  assertTransition(session.status, to);
  const now = ctx.clock.nowIso();
  const updated: LearningSession = {
    ...session,
    ...extra,
    status: to,
    updatedAt: now,
  };
  await ctx.repos.sessions.update(updated);
  return updated;
}

export async function pauseSession(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string },
): Promise<LearningSession> {
  const now = ctx.clock.nowIso();
  const session = await transitionSession(ctx, input.learnerId, input.sessionId, 'paused', {
    pausedAt: now,
    lastActiveAt: now,
  });
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'session_paused',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `session-paused:${session.id}:${now}`,
    payload: {},
  });
  return session;
}

export async function resumeSession(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string },
): Promise<LearningSession> {
  const now = ctx.clock.nowIso();
  const session = await transitionSession(ctx, input.learnerId, input.sessionId, 'active', {
    pausedAt: null,
    lastActiveAt: now,
  });
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'session_resumed',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `session-resumed:${session.id}:${now}`,
    payload: {},
  });
  return session;
}

export async function abandonSession(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string },
): Promise<LearningSession> {
  const now = ctx.clock.nowIso();
  const session = await transitionSession(ctx, input.learnerId, input.sessionId, 'abandoned', {
    endedAt: now,
    lastActiveAt: now,
  });
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'session_abandoned',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `session-abandoned:${session.id}`,
    payload: {},
  });
  return session;
}

export async function completeSession(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string; note?: string | null },
): Promise<{ session: LearningSession; summary: SessionSummary }> {
  const current = await ctx.repos.sessions.findById(input.sessionId);
  if (!current || current.learnerId !== input.learnerId) {
    throw notFound('LearningSession', input.sessionId);
  }

  const summary = await buildSummary(ctx, input.sessionId, input.note ?? null);
  if (current.status === 'completed') {
    return { session: current, summary: current.summary ?? summary };
  }

  const now = ctx.clock.nowIso();
  const session = await transitionSession(ctx, input.learnerId, input.sessionId, 'completed', {
    endedAt: now,
    lastActiveAt: now,
    summary,
  });

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'session_completed',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `session-completed:${session.id}`,
    payload: { ...summary },
  });

  return { session, summary };
}

async function buildSummary(
  ctx: AppContext,
  sessionId: string,
  note: string | null,
): Promise<SessionSummary> {
  const [activities, assessments] = await Promise.all([
    ctx.repos.activities.listBySession(sessionId),
    ctx.repos.assessments.listBySession(sessionId),
  ]);

  const failed = assessments.filter((assessment) => !assessment.correct);
  const items = await ctx.repos.knowledge.listByIds(
    failed.map((assessment) => assessment.subjectId),
  );
  const byId = new Map(items.map((item) => [item.id, item]));

  return {
    completedItems: assessments.length,
    correctItems: assessments.filter((assessment) => assessment.correct).length,
    skippedItems: activities.filter((activity) => activity.status === 'skipped').length,
    difficulties: failed
      .map((assessment) => byId.get(assessment.subjectId)?.text)
      .filter((text): text is string => !!text)
      .slice(0, 10),
    knowledgeItemIds: [
      ...new Set(activities.map((activity) => activity.subjectId).filter(Boolean)),
    ].slice(0, 100),
    note,
  };
}

export async function findResumableSession(
  ctx: AppContext,
  learnerId: string,
): Promise<LearningSession | null> {
  const session = await ctx.repos.sessions.findResumable(learnerId);
  if (!session) return null;
  return isResumable(session.status) ? session : null;
}

/** Session-scoped correction toggle ("don't correct my grammar"). */
export async function setSessionCorrection(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string; enabled: boolean },
): Promise<LearningSession> {
  const session = await ctx.repos.sessions.findById(input.sessionId);
  if (!session || session.learnerId !== input.learnerId) {
    throw notFound('LearningSession', input.sessionId);
  }
  const now = ctx.clock.nowIso();
  const updated: LearningSession = {
    ...session,
    correctionEnabled: input.enabled,
    updatedAt: now,
  };
  await ctx.repos.sessions.update(updated);
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'user_feedback',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `correction:${session.id}:${input.enabled}:${now}`,
    payload: { kind: input.enabled ? 'correction_enabled' : 'correction_disabled' },
  });
  return updated;
}
