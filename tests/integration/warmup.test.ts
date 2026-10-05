import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import {
  advanceWarmup,
  getSessionView,
  skipWarmup,
  startSession,
} from '@/application/sessions';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('M2 §D1: warmup phase', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });
  afterEach(() => h.cleanup());

  it('exposes new items without assessment and records warmup_completed', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '我想提高英语口语' });
    const a = await createKnowledgeItem(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'alpha',
      meaning: '甲',
    });
    const b = await createKnowledgeItem(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'beta',
      meaning: '乙',
    });

    const { session, activities } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 5,
      clientToken: 'warmup-token',
    });

    // startSession returns assessable activities only; warmup is exposure-only.
    expect(activities.every((activity) => activity.kind !== 'warmup_exposure')).toBe(true);

    let view = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    expect(view.warmup.activities).toHaveLength(2);
    expect(view.warmup.nextPending).not.toBeNull();

    for (const warmupActivity of [...view.warmup.activities]) {
      view = await advanceWarmup(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        sessionId: session.id,
        activityId: warmupActivity.id,
      });
    }

    const events = await ctx.repos.events.listBySession(session.id);
    const warmupEvent = events.find((event) => event.type === 'warmup_completed');
    expect(warmupEvent).toBeDefined();
    expect((warmupEvent!.payload as { itemIds: string[] }).itemIds.sort()).toEqual(
      [a.item.id, b.item.id].sort(),
    );

    // Exposure produces no score, no assessment, and no mastery change.
    expect(await ctx.repos.assessments.listBySession(session.id)).toHaveLength(0);
    const state = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', a.item.id);
    expect(state?.exposureCount).toBe(0);
    expect(view.warmup.nextPending).toBeNull();
  });

  it('supports skipping the whole warmup without failure', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '我想提高英语口语' });
    const a = await createKnowledgeItem(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'alpha',
      meaning: '甲',
    });
    await createKnowledgeItem(ctx, { learnerId: LOCAL_LEARNER_ID, text: 'beta', meaning: '乙' });

    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 5,
      clientToken: 'warmup-skip',
    });

    const view = await skipWarmup(ctx, { learnerId: LOCAL_LEARNER_ID, sessionId: session.id });
    expect(view.warmup.nextPending).toBeNull();

    const events = await ctx.repos.events.listBySession(session.id);
    expect(events.some((event) => event.type === 'warmup_completed')).toBe(true);

    // Skipping warmup is not failure and leaves no negative evidence.
    const state = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', a.item.id);
    expect(state?.failedAttempts ?? 0).toBe(0);
  });
});
