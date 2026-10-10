import type {
  Assessment,
  KnowledgeItem,
  LearnerState,
  LearningActivity,
  LearningEvent,
  LearningSession,
  SessionSummary,
} from '@/domain/entities';
import type { ActivityType, SessionStatus, SkillKind } from '@/domain/enums';
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
import { canRequeue, orderByLadder } from '@/assessment/grouping';
import { submitAssessment } from './assessment';
import { appendEvent } from './events';
import { buildPlacementSpecs, finalizePlacementFromSession } from './placement';
import { buildSchedulerSnapshot } from './recommendations';
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
  /** Next pending test activity (warmup cards are tracked separately). */
  nextActivity: LearningActivity | null;
  /** Progress over test activities only (warmup is exposure, not a task). */
  progress: { answered: number; skipped: number; total: number };
  knowledgeById: Record<string, KnowledgeItem>;
  /** Warmup phase state (v0.3 §D1). */
  warmup: { activities: LearningActivity[]; nextPending: LearningActivity | null };
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
  placement: 1.5,
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

  const recommendation = input.recommendationId
    ? await ctx.repos.recommendations.findById(input.recommendationId)
    : null;
  if (
    input.recommendationId &&
    (!recommendation ||
      recommendation.learnerId !== input.learnerId ||
      recommendation.status !== 'offered')
  ) {
    throw notFound('Recommendation', input.recommendationId);
  }
  if (recommendation && recommendation.activityType !== input.activityType) {
    throw validationFailed('推荐活动类型不匹配');
  }
  const now = ctx.clock.nowIso();
  const goalId =
    recommendation?.goalId ??
    input.goalId ??
    (await ctx.repos.goals.findPrimary(input.learnerId))?.id ??
    null;
  const plannedDurationMinutes =
    recommendation?.plannedDurationMinutes ?? input.plannedDurationMinutes ?? null;

  const session: LearningSession = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    goalId,
    recommendationId: input.recommendationId ?? null,
    activityType: input.activityType,
    status: 'active',
    plannedDurationMinutes,
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

  const itemLimit =
    recommendation?.estimatedItemCount ??
    input.itemLimit ??
    Math.max(
      1,
      Math.round((plannedDurationMinutes ?? 5) * (ITEMS_PER_MINUTE[input.activityType] || 0)),
    );

  const isPlacement = input.activityType === 'placement';
  const specs = isPlacement
    ? await buildPlacementSpecs(ctx, input.learnerId)
    : await planActivities(
        ctx,
        input.learnerId,
        input.activityType,
        itemLimit,
        recommendation?.subjectIds ?? [],
      );
  // Warmup (v0.3 §D1): new items are exposed first without being tested.
  // Placement is measurement only — no warmup, and its four-dimension order is
  // fixed (vocabulary → spelling → listening → writing), not ladder-reordered.
  const warmupSpecs = isPlacement
    ? []
    : await buildWarmupSpecs(
        ctx,
        input.learnerId,
        specs.map((spec) => spec.subjectId),
      );
  // Test questions follow the recognition → recall → production ladder (v0.3 §D2).
  const orderedTestSpecs = isPlacement ? specs : orderByLadder(specs);
  const activities: LearningActivity[] = [...warmupSpecs, ...orderedTestSpecs].map(
    (spec, index) => ({
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
    }),
  );
  // Capture a skill-mastery snapshot so the settlement page can show "what
  // changed this session" honestly (v0.3 §D3). Stored in the event payload,
  // never in a new table.
  const skillStatesBefore = await ctx.repos.states.listBySubjectType(input.learnerId, 'skill');
  const masteryBefore = Object.fromEntries(
    skillStatesBefore.map((state) => [state.subjectId, state.mastery]),
  );
  const events: LearningEvent[] = [
    {
      id: ctx.ids.next(),
      learnerId: input.learnerId,
      sessionId: session.id,
      type: 'session_started',
      occurredAt: now,
      payload: {
        activityType: input.activityType,
        plannedDurationMinutes: session.plannedDurationMinutes,
        itemCount: activities.length,
        masteryBefore,
      },
      source: 'user',
      version: 1,
      idempotencyKey: `session-started:${session.id}`,
      createdAt: now,
    },
  ];
  if (recommendation) {
    events.push({
      id: ctx.ids.next(),
      learnerId: input.learnerId,
      sessionId: session.id,
      type: 'recommendation_accepted',
      occurredAt: now,
      payload: { recommendationId: recommendation.id, activityType: recommendation.activityType },
      source: 'user',
      version: 1,
      idempotencyKey: `recommendation-accepted:${recommendation.id}`,
      createdAt: now,
    });
  }
  const committed = await ctx.repos.sessionStarts.commit({
    session,
    activities,
    events,
    recommendationId: recommendation?.id ?? null,
  });
  if (!committed) throw validationFailed('这个推荐已经开始或失效，请刷新首页');
  return {
    session: committed.session,
    // Callers treat `activities` as the assessable task list; warmup cards are
    // exposure-only and tracked through the session view's `warmup` field.
    activities: committed.activities.filter((activity) => activity.kind !== 'warmup_exposure'),
    created: committed.created,
  };
}

/** Chooses the concrete items for an activity type — deterministic selection. */
async function planActivities(
  ctx: AppContext,
  learnerId: string,
  activityType: ActivityType,
  itemLimit: number,
  preferredSubjectIds: string[] = [],
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
  entries = prioritizeEntries(entries, preferredSubjectIds);

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

function prioritizeEntries<T extends { item: KnowledgeItem }>(
  entries: T[],
  preferredSubjectIds: string[],
): T[] {
  if (preferredSubjectIds.length === 0) return entries;
  const order = new Map(preferredSubjectIds.map((id, index) => [id, index]));
  return [...entries].sort((a, b) => {
    const aOrder = order.get(a.item.id);
    const bOrder = order.get(b.item.id);
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;
    return 0;
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

/**
 * New items (never exposed) are warmed up before testing (v0.3 §D1). A subject
 * is "new" when it has no learner state yet or its exposure count is zero.
 */
async function buildWarmupSpecs(
  ctx: AppContext,
  learnerId: string,
  subjectIds: string[],
): Promise<ReviewItemSpec[]> {
  const unique = [...new Set(subjectIds)];
  if (unique.length === 0) return [];
  const states = await ctx.repos.states.listBySubjectIds(learnerId, 'knowledge_item', unique);
  const stateById = new Map(states.map((state) => [state.subjectId, state]));
  const newIds = unique.filter((id) => {
    const state = stateById.get(id);
    return !state || state.exposureCount === 0;
  });
  if (newIds.length === 0) return [];
  const items = await ctx.repos.knowledge.listByIds(newIds);
  const itemById = new Map(items.map((item) => [item.id, item]));
  return newIds.map((id) => ({
    kind: 'warmup_exposure',
    modality: 'recognition',
    subjectId: id,
    prompt: itemById.get(id)?.text ?? '热身',
    options: null,
    expectedAnswer: null,
    hint: null,
  }));
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
  const testActivities = activities.filter((activity) => activity.kind !== 'warmup_exposure');
  const warmupActivities = activities.filter((activity) => activity.kind === 'warmup_exposure');

  return {
    session,
    activities,
    nextActivity:
      testActivities.find((activity) => activity.status === 'pending') ?? null,
    progress: {
      answered: testActivities.filter((activity) => activity.status === 'answered').length,
      skipped: testActivities.filter((activity) => activity.status === 'skipped').length,
      total: testActivities.length,
    },
    knowledgeById: Object.fromEntries(items.map((item) => [item.id, item])),
    warmup: {
      activities: warmupActivities,
      nextPending:
        warmupActivities.find((activity) => activity.status === 'pending') ?? null,
    },
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
  if (activity.kind === 'review_dictation' && activity.expectedAnswer) {
    // Dictation (v0.3 §D2): the learner types what they heard. Fuzzy text
    // match, case/whitespace-insensitive. When the browser lacks TTS the card
    // falls back to four-choice recognition, whose correct option is `hint`.
    const answer = (input.answer ?? '').trim();
    if (activity.options && activity.options.includes(answer)) {
      grade = gradeChoice(activity.hint ?? activity.expectedAnswer, answer);
    } else {
      grade = gradeTextAnswer(languageCode, activity.expectedAnswer, answer);
    }
    score = grade.score;
  } else if (activity.expectedAnswer && activity.options && activity.options.length > 0) {
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
    // Placement measures, never learns (v0.4 §G1).
    skipStateUpdate: session.activityType === 'placement',
  });

  const now = ctx.clock.nowIso();
  await ctx.repos.activities.update({ ...activity, status: 'answered', updatedAt: now });
  await ctx.repos.sessions.update({
    ...session,
    status: session.status === 'created' ? 'active' : session.status,
    lastActiveAt: now,
    updatedAt: now,
  });

  // Wrong-answer requeue (v0.3 §D2): a wrong item re-appears later in the
  // session, but at most MAX_REQUEUE_ROUNDS extra times. After that it stops
  // (no infinite loop) and is left to the due scheduler.
  if (score < 0.6 && activity.kind !== 'warmup_exposure') {
    await requeueWrongSubject(ctx, session.id, input.learnerId, activity, item);
  }

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

/**
 * Appends a re-test activity for a subject answered wrong, gated by the 2-round
 * limit. The re-queued question uses the same test kind so the learner gets one
 * more chance to answer correctly.
 */
async function requeueWrongSubject(
  ctx: AppContext,
  sessionId: string,
  learnerId: string,
  wrongActivity: LearningActivity,
  item: KnowledgeItem | null,
): Promise<void> {
  const existing = await ctx.repos.activities.listBySession(sessionId);
  const testAppearances = existing.filter(
    (activity) =>
      activity.subjectId === wrongActivity.subjectId && activity.kind !== 'warmup_exposure',
  ).length;
  if (!canRequeue(testAppearances)) return;

  const nextPosition = existing.reduce((max, activity) => Math.max(max, activity.position), 0) + 1;
  const now = ctx.clock.nowIso();
  const requeue: LearningActivity = {
    id: ctx.ids.next(),
    sessionId,
    learnerId,
    position: nextPosition,
    kind: wrongActivity.kind,
    modality: wrongActivity.modality,
    subjectType: 'knowledge_item',
    subjectId: wrongActivity.subjectId,
    prompt: wrongActivity.prompt,
    options: wrongActivity.options,
    expectedAnswer: wrongActivity.expectedAnswer,
    hint: wrongActivity.hint ?? item?.meaning ?? null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.activities.createMany([requeue]);
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

/**
 * Marks one warmup exposure card as seen. When the last warmup card is done,
 * a `warmup_completed` event is recorded (v0.3 §D1) — exposure only, no score.
 */
export async function advanceWarmup(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string; activityId: string },
): Promise<SessionView> {
  const activity = await ctx.repos.activities.findById(input.activityId);
  if (
    !activity ||
    activity.sessionId !== input.sessionId ||
    activity.kind !== 'warmup_exposure'
  ) {
    throw notFound('LearningActivity', input.activityId);
  }
  if (activity.status === 'pending') {
    const now = ctx.clock.nowIso();
    await ctx.repos.activities.update({ ...activity, status: 'answered', updatedAt: now });
  }
  await maybeCompleteWarmup(ctx, input.learnerId, input.sessionId);
  return getSessionView(ctx, input.learnerId, input.sessionId);
}

/** Skips the whole warmup phase. Skipping is never failure (v0.3 §D1). */
export async function skipWarmup(
  ctx: AppContext,
  input: { learnerId: string; sessionId: string },
): Promise<SessionView> {
  const now = ctx.clock.nowIso();
  const warmups = (await ctx.repos.activities.listBySession(input.sessionId)).filter(
    (activity) => activity.kind === 'warmup_exposure' && activity.status === 'pending',
  );
  for (const activity of warmups) {
    await ctx.repos.activities.update({ ...activity, status: 'skipped', updatedAt: now });
  }
  await maybeCompleteWarmup(ctx, input.learnerId, input.sessionId);
  return getSessionView(ctx, input.learnerId, input.sessionId);
}

async function maybeCompleteWarmup(
  ctx: AppContext,
  learnerId: string,
  sessionId: string,
): Promise<void> {
  const activities = await ctx.repos.activities.listBySession(sessionId);
  const warmups = activities.filter((activity) => activity.kind === 'warmup_exposure');
  if (warmups.length === 0 || warmups.some((activity) => activity.status === 'pending')) return;
  const itemIds = warmups
    .filter((activity) => activity.status === 'answered')
    .map((activity) => activity.subjectId);
  await appendEvent(ctx, {
    learnerId,
    type: 'warmup_completed',
    source: 'user',
    sessionId,
    idempotencyKey: `warmup-completed:${sessionId}`,
    payload: { itemIds },
  });
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

  // Placement session (v0.4 §G1): finalise the level estimate once completed.
  // Idempotent on the session id, and never part of the streak/mastery path.
  if (session.activityType === 'placement') {
    await finalizePlacementFromSession(ctx, input.learnerId, session.id);
  }

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
  // Warmup cards are exposure, not tasks: they contribute no score and are not
  // "skipped" or part of the assessed item set (v0.3 §D1).
  const testActivities = activities.filter((activity) => activity.kind !== 'warmup_exposure');

  return {
    completedItems: assessments.length,
    correctItems: assessments.filter((assessment) => assessment.correct).length,
    skippedItems: testActivities.filter((activity) => activity.status === 'skipped').length,
    difficulties: failed
      .map((assessment) => byId.get(assessment.subjectId)?.text)
      .filter((text): text is string => !!text)
      .slice(0, 10),
    knowledgeItemIds: [
      ...new Set(testActivities.map((activity) => activity.subjectId).filter(Boolean)),
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

export interface MasteryChange {
  skill: SkillKind;
  before: number;
  after: number;
}

/**
 * Skill-mastery change over a session (v0.3 §D3). "Before" comes from the
 * snapshot recorded in the session_started event; skills that did not move are
 * omitted so the UI never fabricates a change.
 */
export async function getSessionMasteryChanges(
  ctx: AppContext,
  learnerId: string,
  sessionId: string,
): Promise<MasteryChange[]> {
  const events = await ctx.repos.events.listBySession(sessionId);
  const started = events.find((event) => event.type === 'session_started');
  const before = (started?.payload.masteryBefore as Record<string, number> | undefined) ?? {};
  const skillStates = await ctx.repos.states.listBySubjectType(learnerId, 'skill');
  const changes: MasteryChange[] = [];
  for (const state of skillStates) {
    const beforeValue = before[state.subjectId];
    if (beforeValue !== undefined && Math.abs(state.mastery - beforeValue) >= 0.01) {
      changes.push({ skill: state.subjectId as SkillKind, before: beforeValue, after: state.mastery });
    }
  }
  return changes;
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
