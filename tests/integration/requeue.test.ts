import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import {
  getSessionView,
  skipWarmup,
  startSession,
  submitActivityAnswer,
} from '@/application/sessions';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('M3 §D2: wrong-answer requeue', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });
  afterEach(() => h.cleanup());

  async function startSingleItemSession() {
    await createGoalFromText(h.ctx, { learnerId: LOCAL_LEARNER_ID, text: '我想提高英语口语' });
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
    });
    const { session } = await startSession(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      plannedDurationMinutes: 5,
      clientToken: `requeue-${Math.random()}`,
    });
    await skipWarmup(h.ctx, { learnerId: LOCAL_LEARNER_ID, sessionId: session.id });
    return session.id;
  }

  async function answerWrong(sessionId: string) {
    const view = await getSessionView(h.ctx, LOCAL_LEARNER_ID, sessionId);
    const activity = view.nextActivity;
    if (!activity) throw new Error('no next activity');
    await submitActivityAnswer(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId,
      activityId: activity.id,
      answer: activity.options ? 'definitely-wrong' : 'zzzzz',
      selfRating: null,
    });
    return activity.subjectId;
  }

  async function pendingTestCount(sessionId: string, subjectId: string): Promise<number> {
    const view = await getSessionView(h.ctx, LOCAL_LEARNER_ID, sessionId);
    return view.activities.filter(
      (activity) =>
        activity.subjectId === subjectId &&
        activity.kind !== 'warmup_exposure' &&
        activity.status === 'pending',
    ).length;
  }

  it('re-queues a wrong item at most 2 extra rounds, then stops', async () => {
    const sessionId = await startSingleItemSession();
    const subjectId = await answerWrong(sessionId);

    // After the first wrong answer, the item re-appears once.
    expect(await pendingTestCount(sessionId, subjectId)).toBe(1);

    // Answer the re-queued copy wrong -> it re-appears a second time.
    await answerWrong(sessionId);
    expect(await pendingTestCount(sessionId, subjectId)).toBe(1);

    // Answer wrong a third time -> the 2-round limit is hit, no more requeue.
    await answerWrong(sessionId);
    expect(await pendingTestCount(sessionId, subjectId)).toBe(0);
  });
});
