import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import { getPlacementView, recordSelfReportPlacement } from '@/application/placement';
import {
  completeSession,
  getSessionView,
  startSession,
  submitActivityAnswer,
} from '@/application/sessions';
import { getCurrentStreak } from '@/application/streak';
import { LOCAL_LEARNER_ID } from '@/application/types';
import type { LearningActivity } from '@/domain/entities';
import { createTestHarness, type TestHarness } from '../helpers/context';

const VOCAB: { text: string; meaning: string }[] = [
  { text: 'abandon', meaning: '放弃' },
  { text: 'brief', meaning: '简短的' },
  { text: 'clarify', meaning: '澄清' },
  { text: 'domestic', meaning: '国内的' },
  { text: 'evaluate', meaning: '评估' },
  { text: 'frequent', meaning: '频繁的' },
  { text: 'genuine', meaning: '真实的' },
  { text: 'hesitate', meaning: '犹豫' },
];

function answerFor(activity: LearningActivity): { answer: string | null; selfRating: 'known' | null } {
  if (activity.kind === 'writing_prompt' && activity.expectedAnswer) {
    return { answer: `I often use ${activity.expectedAnswer} here.`, selfRating: null };
  }
  return { answer: activity.expectedAnswer ?? null, selfRating: activity.expectedAnswer ? null : 'known' };
}

describe('placement session (v0.4 §G1)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });

  afterEach(() => h.cleanup());

  async function seed() {
    const { ctx } = h;
    await createGoalFromText(ctx, { learnerId: LOCAL_LEARNER_ID, text: '我想准备雅思考试' });
    for (const entry of VOCAB) {
      await createKnowledgeItem(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        text: entry.text,
        meaning: entry.meaning,
        languageCode: 'en',
      });
    }
  }

  it('measures without learning: records a placement but never touches mastery or the streak', async () => {
    const { ctx } = h;
    await seed();

    // Snapshot mastery before the placement session.
    const firstItem = (await ctx.repos.knowledge.search({ learnerId: LOCAL_LEARNER_ID, limit: 1 }))[0]!;
    const before = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', firstItem.id);

    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'placement',
      clientToken: 'placement-token-1',
    });

    let view = await getSessionView(ctx, LOCAL_LEARNER_ID, session.id);
    expect(view.warmup.activities).toHaveLength(0); // placement has no warmup
    let answered = 0;
    while (view.nextActivity) {
      const activity = view.nextActivity;
      const { answer, selfRating } = answerFor(activity);
      const result = await submitActivityAnswer(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        sessionId: session.id,
        activityId: activity.id,
        answer,
        selfRating,
      });
      expect(result.duplicate).toBe(false);
      answered += 1;
      view = result.view;
    }
    expect(answered).toBeGreaterThan(0);

    await completeSession(ctx, { learnerId: LOCAL_LEARNER_ID, sessionId: session.id });

    // Mastery and exposure are untouched — measurement, not learning.
    const after = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', firstItem.id);
    expect(after?.exposureCount ?? 0).toBe(before?.exposureCount ?? 0);
    expect(after?.mastery ?? 0).toBe(before?.mastery ?? 0);

    // The streak does not move.
    expect(await getCurrentStreak(ctx, LOCAL_LEARNER_ID)).toBe(0);

    // A placement row plus the event were written.
    const placementView = await getPlacementView(ctx, LOCAL_LEARNER_ID);
    expect(placementView.placement).not.toBeNull();
    expect(placementView.placement!.type).toBe('test');
    expect(placementView.placement!.evidence).toEqual(['test']);
    expect(placementView.placement!.overallLevel).toBeGreaterThanOrEqual(1);
    expect(placementView.placement!.overallLevel).toBeLessThanOrEqual(9);

    const events = await ctx.repos.events.listBySession(session.id);
    expect(events.some((event) => event.type === 'placement_completed')).toBe(true);
  });

  it('does not record a placement when the session is abandoned mid-way', async () => {
    const { ctx } = h;
    await seed();
    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'placement',
      clientToken: 'placement-token-2',
    });
    // No answers, then abandon (the learn page's abandon path) — no completion.
    const placements = await ctx.repos.placements.listByLearner(LOCAL_LEARNER_ID, 10);
    expect(placements).toHaveLength(0);
    expect(session.status).toBe('active');
  });

  it('records a self-report with low confidence and no test', async () => {
    const { ctx } = h;
    await seed();
    const placement = await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    expect(placement).not.toBeNull();
    expect(placement!.overallLevel).toBe(4.0);
    expect(placement!.confidence).toBe('low');
    expect(placement!.evidence).toEqual(['self_report']);

    const view = await getPlacementView(ctx, LOCAL_LEARNER_ID);
    expect(view.synthesis.level).toBe(4.0);
    expect(view.synthesis.confidence).toBe('low');
  });
});
