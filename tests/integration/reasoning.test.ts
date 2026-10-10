import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import { recordSelfReportPlacement } from '@/application/placement';
import { buildStartupReason } from '@/application/reasoning';
import { generateRecommendations } from '@/application/recommendations';
import { completeSession, startSession } from '@/application/sessions';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('startup reason (v0.4 §G4)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });

  afterEach(() => h.cleanup());

  async function seedKnowledge() {
    for (const entry of [
      { text: 'curriculum', meaning: '课程大纲' },
      { text: 'syllabus', meaning: '教学大纲' },
      { text: 'enroll', meaning: '注册' },
      { text: 'routine', meaning: '日常' },
    ]) {
      await createKnowledgeItem(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        text: entry.text,
        meaning: entry.meaning,
        languageCode: 'en',
      });
    }
  }

  it('falls back to the v0.3 wording when the goal has no phases (未校准)', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '提高商务英语' });
    await seedKnowledge();
    // No placement → no phases.
    const { recommendations } = await generateRecommendations(ctx, LOCAL_LEARNER_ID, 1);
    const reason = await buildStartupReason(ctx, LOCAL_LEARNER_ID, recommendations[0]!);
    expect(reason).toBe(recommendations[0]!.reason);
    expect(reason).not.toContain('阶段');
  });

  it('omits the yesterday and gap clauses when there is no data', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
      goalType: 'ielts',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    await seedKnowledge();

    const { recommendations } = await generateRecommendations(ctx, LOCAL_LEARNER_ID, 1);
    const reason = await buildStartupReason(ctx, LOCAL_LEARNER_ID, recommendations[0]!);
    expect(reason).toContain('第1阶段');
    expect(reason).not.toContain('昨天');
    expect(reason).not.toContain('话题正确率');
  });

  it('includes a yesterday clause once the learner studied the previous day', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
      goalType: 'ielts',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    await seedKnowledge();

    // Study on day 1, then move to day 2 so day 1 is "yesterday".
    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      clientToken: 'reason-yesterday',
    });
    await completeSession(ctx, { learnerId: LOCAL_LEARNER_ID, sessionId: session.id });
    h.clock.advanceDays(1);

    const { recommendations } = await generateRecommendations(ctx, LOCAL_LEARNER_ID, 1);
    const reason = await buildStartupReason(ctx, LOCAL_LEARNER_ID, recommendations[0]!);
    expect(reason).toContain('昨天学了');
  });
});
