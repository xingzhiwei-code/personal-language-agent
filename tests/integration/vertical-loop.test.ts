import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { correctAssessment } from '@/application/assessment';
import { captureContext } from '@/application/context';
import { createGoalFromText } from '@/application/goals';
import { getHomeView } from '@/application/home';
import { createKnowledgeItem } from '@/application/knowledge';
import { generateRecommendations } from '@/application/recommendations';
import {
  completeSession,
  getSessionView,
  pauseSession,
  resumeSession,
  skipActivity,
  startSession,
  submitActivityAnswer,
} from '@/application/sessions';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

const VOCAB: { text: string; meaning: string }[] = [
  { text: 'figure out', meaning: '弄清楚' },
  { text: 'give up', meaning: '放弃' },
  { text: 'look after', meaning: '照顾' },
  { text: 'run into', meaning: '偶然遇到' },
  { text: 'put off', meaning: '推迟' },
  { text: 'come up with', meaning: '想出' },
];

describe('vertical loop: goal -> recommendation -> session -> assessment -> state -> new recommendation', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
    // The whole core loop must work with NO AI provider configured.
    harness.llm.configured = false;
  });

  afterEach(() => {
    harness.cleanup();
  });

  async function seedGoalAndKnowledge() {
    const { ctx } = harness;
    const goal = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语口语',
    });
    for (const entry of VOCAB) {
      await createKnowledgeItem(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        text: entry.text,
        meaning: entry.meaning,
        languageCode: 'en',
      });
    }
    return goal;
  }

  it('creates a goal with low-confidence initial state', async () => {
    const { ctx } = harness;
    const { goal, targets } = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语口语',
    });

    expect(goal.languageCode).toBe('en');
    expect(goal.isPrimary).toBe(true);
    expect(targets.some((target) => target.skill === 'speaking')).toBe(true);

    const state = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'skill', 'speaking');
    expect(state).not.toBeNull();
    expect(state?.mastery).toBe(0);
    expect(state?.confidence).toBeLessThan(0.2);
    expect(state?.trend).toBe('unknown');
  });

  it('does not create duplicate goals for a repeated submission', async () => {
    const { ctx } = harness;
    const first = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语口语',
    });
    const second = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语口语',
    });

    expect(second.deduplicated).toBe(true);
    expect(second.goal.id).toBe(first.goal.id);
    expect((await ctx.repos.goals.listByLearner(LOCAL_LEARNER_ID)).length).toBe(1);
  });

  it('runs the whole loop and changes the next recommendation', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();

    const home = await getHomeView(ctx, LOCAL_LEARNER_ID);
    expect(home.hasGoal).toBe(true);
    expect(home.primary).not.toBeNull();
    expect(home.primary?.requiresAi).toBe(false);
    expect(home.stats.dueCount).toBe(VOCAB.length);
    const dueBefore = home.stats.dueCount;

    const { session, activities } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: home.primary!.activityType,
      plannedDurationMinutes: home.primary!.plannedDurationMinutes,
      recommendationId: home.primary!.id,
      clientToken: 'token-loop-1',
    });
    expect(activities.length).toBeGreaterThan(0);
    expect(session.status).toBe('active');

    // Answer every question correctly.
    let view = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    while (view.nextActivity) {
      const activity = view.nextActivity;
      const answer = activity.expectedAnswer ?? null;
      const result = await submitActivityAnswer(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        sessionId: session.id,
        activityId: activity.id,
        answer,
        selfRating: answer ? null : 'known',
      });
      expect(result.duplicate).toBe(false);
      expect(result.score).toBeGreaterThan(0);
      expect(result.state?.mastery ?? 0).toBeGreaterThan(0);
      view = result.view;
    }

    // Answering the last item does NOT close the session immediately: the
    // learner must still see the feedback. The UI closes it when moving on.
    const beforeClose = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    expect(beforeClose.session.status).toBe('active');
    expect(beforeClose.nextActivity).toBeNull();

    await completeSession(ctx, { learnerId: LOCAL_LEARNER_ID, sessionId: session.id });
    const finished = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    expect(finished.session.status).toBe('completed');
    expect(finished.session.summary?.completedItems).toBe(activities.length);

    // Events are the source of truth.
    const events = await ctx.repos.events.listBySession(session.id);
    expect(events.filter((event) => event.type === 'assessment_recorded').length).toBe(
      activities.length,
    );

    // Learner state was updated deterministically.
    const answeredId = activities[0]!.subjectId;
    const state = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', answeredId);
    expect(state?.exposureCount).toBe(1);
    expect(state?.mastery).toBeGreaterThan(0);
    expect(state?.nextReviewAt).not.toBeNull();
    expect(Date.parse(state!.nextReviewAt!)).toBeGreaterThan(Date.parse(harness.clock.nowIso()));

    // Skill-level aggregation happened too.
    const vocabulary = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'skill', 'vocabulary');
    expect(vocabulary?.exposureCount).toBeGreaterThan(0);

    // And the next recommendation reflects the new evidence.
    const homeAfter = await getHomeView(ctx, LOCAL_LEARNER_ID);
    expect(homeAfter.stats.dueCount).toBeLessThan(dueBefore);
    expect(homeAfter.stats.answersLast7Days).toBe(activities.length);
    expect(homeAfter.primary?.id).not.toBe(home.primary?.id);
  });

  it('never double counts a resubmitted answer', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();
    const { session, activities } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 3,
      clientToken: 'token-idem-1',
    });

    const activity = activities[0]!;
    const first = await submitActivityAnswer(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      activityId: activity.id,
      answer: activity.expectedAnswer,
      selfRating: activity.expectedAnswer ? null : 'known',
    });
    const second = await submitActivityAnswer(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      activityId: activity.id,
      answer: activity.expectedAnswer,
      selfRating: activity.expectedAnswer ? null : 'known',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const state = await ctx.repos.states.find(
      LOCAL_LEARNER_ID,
      'knowledge_item',
      activity.subjectId,
    );
    expect(state?.exposureCount).toBe(1);

    const assessments = await ctx.repos.assessments.listBySession(session.id);
    expect(assessments.filter((entry) => entry.subjectId === activity.subjectId)).toHaveLength(1);
  });

  it('never creates two sessions for the same client token', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();
    const first = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      clientToken: 'same-token',
      plannedDurationMinutes: 3,
    });
    const second = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      clientToken: 'same-token',
      plannedDurationMinutes: 3,
    });

    expect(second.created).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    expect((await ctx.repos.sessions.listByLearner(LOCAL_LEARNER_ID, 10)).length).toBe(1);
  });

  it('matches a declared 3-minute window', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();
    await captureContext(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      rawInput: '我现在只有 3 分钟',
    });

    const { recommendations, snapshot } = await generateRecommendations(
      ctx,
      LOCAL_LEARNER_ID,
      3,
    );
    expect(snapshot.context?.availableMinutes).toBe(3);
    expect(recommendations.length).toBeGreaterThan(0);
    for (const recommendation of recommendations) {
      expect(recommendation.plannedDurationMinutes).toBeLessThanOrEqual(3);
    }
  });

  it('supports pause, resume and skip without losing progress', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();
    const { session, activities } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 5,
      clientToken: 'token-pause',
    });

    await submitActivityAnswer(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      activityId: activities[0]!.id,
      answer: activities[0]!.expectedAnswer,
      selfRating: activities[0]!.expectedAnswer ? null : 'known',
    });

    const paused = await pauseSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
    });
    expect(paused.status).toBe('paused');

    const home = await getHomeView(ctx, LOCAL_LEARNER_ID);
    expect(home.resumable?.id).toBe(session.id);

    const resumed = await resumeSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
    });
    expect(resumed.status).toBe('active');

    const view = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    expect(view.progress.answered).toBe(1);
    expect(view.nextActivity).not.toBeNull();

    // Skipping produces no negative evidence.
    const skipped = await skipActivity(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      activityId: view.nextActivity!.id,
    });
    expect(skipped.progress.skipped).toBe(1);
    const skippedState = await ctx.repos.states.find(
      LOCAL_LEARNER_ID,
      'knowledge_item',
      view.nextActivity!.subjectId,
    );
    expect(skippedState?.failedAttempts ?? 0).toBe(0);
  });

  it('completing twice is idempotent', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();
    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 3,
      clientToken: 'token-complete',
    });

    const first = await completeSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
    });
    const second = await completeSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
    });

    expect(first.session.status).toBe('completed');
    expect(second.session.status).toBe('completed');
    const events = await ctx.repos.events.listBySession(session.id);
    expect(events.filter((event) => event.type === 'session_completed')).toHaveLength(1);
  });

  it('keeps data after an application restart', async () => {
    const { ctx } = harness;
    await seedGoalAndKnowledge();
    const { session, activities } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 3,
      clientToken: 'token-restart',
    });
    await submitActivityAnswer(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      activityId: activities[0]!.id,
      answer: activities[0]!.expectedAnswer,
      selfRating: activities[0]!.expectedAnswer ? null : 'known',
    });

    const restarted = harness.reopen();
    harness = restarted;
    restarted.llm.configured = false;

    const goals = await restarted.ctx.repos.goals.listByLearner(LOCAL_LEARNER_ID);
    expect(goals).toHaveLength(1);
    const state = await restarted.ctx.repos.states.find(
      LOCAL_LEARNER_ID,
      'knowledge_item',
      activities[0]!.subjectId,
    );
    expect(state?.exposureCount).toBe(1);
    const events = await restarted.ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('the user can correct the system', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
    harness.llm.configured = false;
  });

  afterEach(() => harness.cleanup());

  /** Starts a review session and answers the first item wrongly on purpose. */
  async function answerWrongly() {
    const { ctx } = harness;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '我想提高英语口语' });
    const { item } = await createKnowledgeItem(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
    });

    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      clientToken: 'correction-token',
    });
    const view = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    const activity = view.nextActivity!;

    const result = await submitActivityAnswer(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      activityId: activity.id,
      answer: activity.expectedAnswer ? 'definitely wrong' : null,
      selfRating: activity.expectedAnswer ? null : 'forgot',
    });

    return { item, session, activity, result };
  }

  it('accepts "I was actually right" and re-derives the state from corrected evidence', async () => {
    const { ctx } = harness;
    const { item, result } = await answerWrongly();

    expect(result.assessment).not.toBeNull();
    expect(result.assessment!.correct).toBe(false);

    const before = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', item.id);
    expect(before?.exposureCount).toBe(1);
    expect(before?.failedAttempts).toBe(1);
    expect(before?.successfulAttempts).toBe(0);

    const corrected = await correctAssessment(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      assessmentId: result.assessment!.id,
      correctedScore: 1,
    });

    // The stored assessment reflects the user's correction and is flagged as such.
    expect(corrected.assessment.score).toBe(1);
    expect(corrected.assessment.correct).toBe(true);
    expect(corrected.assessment.userCorrected).toBe(true);

    // The wrong evidence was reverted, not stacked on top of.
    expect(corrected.state.exposureCount).toBe(1);
    expect(corrected.state.failedAttempts).toBe(0);
    expect(corrected.state.successfulAttempts).toBe(1);
    expect(corrected.state.mastery).toBeGreaterThan(before!.mastery);

    // One correct answer still must not mean "mastered".
    expect(corrected.state.mastery).toBeLessThan(0.6);
  });

  it('is idempotent: correcting twice does not double-count', async () => {
    const { ctx } = harness;
    const { item, result } = await answerWrongly();

    const first = await correctAssessment(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      assessmentId: result.assessment!.id,
      correctedScore: 1,
    });
    const second = await correctAssessment(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      assessmentId: result.assessment!.id,
      correctedScore: 1,
    });

    expect(second.state.exposureCount).toBe(first.state.exposureCount);
    expect(second.state.successfulAttempts).toBe(first.state.successfulAttempts);
    expect(second.state.mastery).toBeCloseTo(first.state.mastery, 10);

    const state = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', item.id);
    expect(state?.exposureCount).toBe(1);
  });

  it('records the correction as an auditable event and rejects invalid input', async () => {
    const { ctx } = harness;
    const { result } = await answerWrongly();

    await correctAssessment(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      assessmentId: result.assessment!.id,
      correctedScore: 1,
    });

    const events = await ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    const correction = events.find(
      (event) =>
        event.type === 'user_feedback' &&
        (event.payload as { kind?: string }).kind === 'assessment_corrected',
    );
    expect(correction).toBeDefined();
    expect(correction?.source).toBe('user');

    await expect(
      correctAssessment(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        assessmentId: result.assessment!.id,
        correctedScore: 5,
      }),
    ).rejects.toThrow();

    await expect(
      correctAssessment(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        assessmentId: 'does-not-exist',
        correctedScore: 1,
      }),
    ).rejects.toThrow();
  });
});
