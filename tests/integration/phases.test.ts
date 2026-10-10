import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText, updateGoal } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import {
  advancePhase,
  computePhaseProgress,
  listGoalPhases,
  rollbackPhase,
  skipPhase,
} from '@/application/phases';
import { recordSelfReportPlacement } from '@/application/placement';
import { startSession } from '@/application/sessions';
import { LOCAL_LEARNER_ID } from '@/application/types';
import type { Wordlist } from '@/domain/entities';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('goal phases (v0.4 §G2)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });

  afterEach(() => h.cleanup());

  async function seedWordlistBoundToGoal(goalId: string) {
    const { ctx } = h;
    const now = h.clock.nowIso();
    const wordlist: Wordlist = {
      id: ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      name: '测试词库',
      languageCode: 'en',
      goalId,
      tags: [],
      sourceFile: null,
      itemCount: 2,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.repos.wordlists.create(wordlist);
    for (const entry of [
      { text: 'abandon', meaning: '放弃' },
      { text: 'evaluate', meaning: '评估' },
    ]) {
      const { item } = await createKnowledgeItem(ctx, {
        learnerId: LOCAL_LEARNER_ID,
        text: entry.text,
        meaning: entry.meaning,
        languageCode: 'en',
        wordlistId: wordlist.id,
      });
      const state = await ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', item.id);
      await ctx.repos.states.upsert({ ...state!, mastery: 0.9 });
    }
    return wordlist;
  }

  it('generates four IELTS phases and three general phases from a placement', async () => {
    const { ctx } = h;
    const ielts = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
      goalType: 'ielts',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    const ieltsPhases = await listGoalPhases(ctx, ielts.goal.id);
    expect(ieltsPhases).toHaveLength(4);
    expect(ieltsPhases[0]!.status).toBe('active');
    expect(ieltsPhases[1]!.status).toBe('locked');

    const general = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '提高商务英语',
      goalType: 'general',
    });
    const generalPhases = await listGoalPhases(ctx, general.goal.id);
    expect(generalPhases).toHaveLength(3);
  });

  it('computes exit criteria deterministically and marks unmeasured criteria honestly', async () => {
    const { ctx } = h;
    const { goal } = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
      goalType: 'ielts',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    const phases = await listGoalPhases(ctx, goal.id);

    // P1: phase_word_mastery (measured, 0) + placement_retest (unmeasured yet).
    const p1 = await computePhaseProgress(ctx, LOCAL_LEARNER_ID, goal.id, phases[0]!);
    expect(p1.items.some((item) => item.metric === 'phase_word_mastery' && item.measured)).toBe(true);
    expect(p1.items.some((item) => item.metric === 'placement_retest' && !item.measured)).toBe(true);
    expect(p1.exitMet).toBe(false);

    // P2: skill_quiz is not measurable in v0.4 → honest "unmeasured".
    const p2 = await computePhaseProgress(ctx, LOCAL_LEARNER_ID, goal.id, phases[1]!);
    expect(p2.items.every((item) => !item.measured || item.metric === 'phase_word_mastery')).toBe(true);
    expect(p2.items.some((item) => item.metric === 'skill_quiz' && !item.measured)).toBe(true);
    expect(p2.exitMet).toBe(false);
  });

  it('advances only when exit criteria are met, then records phase_completed/phase_started', async () => {
    const { ctx } = h;
    const { goal } = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '提高商务英语',
      goalType: 'general',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    await seedWordlistBoundToGoal(goal.id);
    const phases = await listGoalPhases(ctx, goal.id);
    const progress = await computePhaseProgress(ctx, LOCAL_LEARNER_ID, goal.id, phases[0]!);
    expect(progress.exitMet).toBe(true);

    const advanced = await advancePhase(ctx, LOCAL_LEARNER_ID, goal.id);
    expect(advanced.seq).toBe(2);

    const events = await ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(events.some((event) => event.type === 'phase_completed' && (event.payload as { seq: number }).seq === 1)).toBe(true);
    expect(events.some((event) => event.type === 'phase_started' && (event.payload as { seq: number }).seq === 2)).toBe(true);
  });

  it('rejects auto-advance when exit criteria are not met', async () => {
    const { ctx } = h;
    const { goal } = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '提高商务英语',
      goalType: 'general',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    // No bound words → phase_word_mastery 0 → exit not met.
    await expect(advancePhase(ctx, LOCAL_LEARNER_ID, goal.id)).rejects.toThrow('尚未达到准出标准');
  });

  it('skip and rollback record phase_override events without deleting data', async () => {
    const { ctx } = h;
    const { goal } = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '提高商务英语',
      goalType: 'general',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');

    await skipPhase(ctx, LOCAL_LEARNER_ID, goal.id);
    let phases = await listGoalPhases(ctx, goal.id);
    expect(phases.find((phase) => phase.seq === 1)!.status).toBe('done');
    expect(phases.find((phase) => phase.seq === 2)!.status).toBe('active');

    await rollbackPhase(ctx, LOCAL_LEARNER_ID, goal.id);
    phases = await listGoalPhases(ctx, goal.id);
    expect(phases.find((phase) => phase.seq === 1)!.status).toBe('active');
    expect(phases.find((phase) => phase.seq === 2)!.status).toBe('locked');

    const events = await ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    const overrides = events.filter((event) => event.type === 'phase_override');
    expect(overrides).toHaveLength(2);
    expect(
      overrides.some(
        (event) =>
          (event.payload as { fromSeq: number; direction: string }).fromSeq === 1 &&
          (event.payload as { direction: string }).direction === 'forward',
      ),
    ).toBe(true);
    expect(
      overrides.some(
        (event) =>
          (event.payload as { fromSeq: number; direction: string }).fromSeq === 2 &&
          (event.payload as { direction: string }).direction === 'backward',
      ),
    ).toBe(true);
  });
});

describe('multi-goal switching (v0.4 §G6)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.configured = false;
  });

  afterEach(() => h.cleanup());

  it('writes the primary goalId onto every learning session', async () => {
    const { ctx } = h;
    const { goal } = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '提高商务英语',
    });
    await createKnowledgeItem(ctx, { learnerId: LOCAL_LEARNER_ID, text: 'abandon', meaning: '放弃' });
    const { session } = await startSession(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'quick_review',
      clientToken: 'goal-id-token',
    });
    expect(session.goalId).toBe(goal.id);
  });

  it('switching primary keeps the old goal data intact and regenerates plans for the new primary', async () => {
    const { ctx } = h;
    const first = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
      goalType: 'ielts',
    });
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    h.clock.advanceMinutes(2);
    const second = await createGoalFromText(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '提高商务英语',
      goalType: 'general',
    });
    expect(second.goal.isPrimary).toBe(false);

    const firstPhasesBefore = await listGoalPhases(ctx, first.goal.id);
    expect(firstPhasesBefore).toHaveLength(4);

    await updateGoal(ctx, {
      learnerId: LOCAL_LEARNER_ID,
      goalId: second.goal.id,
      makePrimary: true,
    });

    // Old goal's phases and data are untouched.
    const firstPhasesAfter = await listGoalPhases(ctx, first.goal.id);
    expect(firstPhasesAfter).toHaveLength(4);
    expect(firstPhasesAfter.map((phase) => phase.status)).toEqual(
      firstPhasesBefore.map((phase) => phase.status),
    );
    const primary = await ctx.repos.goals.findPrimary(LOCAL_LEARNER_ID);
    expect(primary?.id).toBe(second.goal.id);
  });
});
