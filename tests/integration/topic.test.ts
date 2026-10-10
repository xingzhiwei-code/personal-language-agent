import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import { ensureDailyPoolPromotion } from '@/application/knowledge-pool';
import { recordSelfReportPlacement } from '@/application/placement';
import { completeSession, startSession } from '@/application/sessions';
import { getCurrentTopic } from '@/application/topic';
import { LOCAL_LEARNER_ID } from '@/application/types';
import type { WordRelation } from '@/domain/entities';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('daily-one-topic rotation (v0.4 §G3)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });

  afterEach(() => h.cleanup());

  async function seedTopicRelation(lemma: string, topic: string) {
    const relation: WordRelation = {
      id: `rel-${lemma}-${topic}`,
      wordLemma: lemma,
      relatedLemma: topic,
      relationType: 'topic',
      topic,
      source: 'topic_list',
    };
    await h.ctx.repos.wordRelations.upsert(relation);
  }

  it('advances the topic after a completed learning day', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '提高商务英语' });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    // First learning day (0 completed) → first topic.
    expect(await getCurrentTopic(ctx, LOCAL_LEARNER_ID)).toBe('daily_life');

    // Complete one learning day by writing a completed non-placement session.
    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      clientToken: 'topic-day-1',
    });
    await completeSession(ctx, { learnerId: LOCAL_LEARNER_ID, sessionId: session.id });
    // Still the same learning day (same clock), so the topic has NOT advanced.
    expect(await getCurrentTopic(ctx, LOCAL_LEARNER_ID)).toBe('daily_life');

    // Move to the next natural day → a new learning day → next topic.
    h.clock.advanceDays(1);
    expect(await getCurrentTopic(ctx, LOCAL_LEARNER_ID)).toBe('education');
  });

  it('promotes topic words first and honestly annotates fallback', async () => {
    const { ctx } = h;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '提高商务英语' });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    // Only ONE word exists in today's topic (daily_life).
    await seedTopicRelation('routine', 'daily_life');

    for (const entry of [
      { text: 'routine', meaning: '日常' },
      { text: 'abandon', meaning: '放弃' },
      { text: 'evaluate', meaning: '评估' },
      { text: 'clarify', meaning: '澄清' },
      { text: 'domestic', meaning: '国内的' },
    ]) {
      await createKnowledgeItem(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        text: entry.text,
        meaning: entry.meaning,
        languageCode: 'en',
        poolMode: true,
      });
    }

    const result = await ensureDailyPoolPromotion(ctx, LOCAL_LEARNER_ID);
    expect(result.topic).toBe('daily_life');
    expect(result.fallbackCount).toBeGreaterThan(0);
    expect(result.reason).toContain('话题词不足');

    // The in-topic word is promoted first.
    expect(result.promoted.some((item) => item.text === 'routine')).toBe(true);
  });
});
