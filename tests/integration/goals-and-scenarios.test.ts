import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoalFromText, updateGoal } from '@/application/goals';
import {
  bindWordlistToGoal,
  createScenario,
  deleteScenario,
  listScenarios,
  updateScenario,
} from '@/application/scenarios';
import type { Wordlist } from '@/domain/entities';
import { createTestHarness, LOCAL_LEARNER_ID, type TestHarness } from '../helpers/context';

describe('M6: primary and secondary goals', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('creates one primary goal and switches primary deterministically', async () => {
    const first = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
    });
    h.clock.advanceMinutes(2);
    const second = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要提高商务英语口语',
    });
    expect(first.goal.isPrimary).toBe(true);
    expect(second.goal.isPrimary).toBe(false);

    await updateGoal(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      goalId: second.goal.id,
      makePrimary: true,
    });
    const goals = await h.ctx.repos.goals.listByLearner(LOCAL_LEARNER_ID, ['active']);
    expect(goals.filter((goal) => goal.isPrimary)).toHaveLength(1);
    expect(goals.find((goal) => goal.id === second.goal.id)).toMatchObject({ isPrimary: true, priority: 1 });
    expect(goals.find((goal) => goal.id === first.goal.id)).toMatchObject({ isPrimary: false, priority: 2 });
    expect((await h.ctx.repos.goals.findPrimary(LOCAL_LEARNER_ID))?.id).toBe(second.goal.id);
  });

  it('promotes a fallback when the current primary is paused', async () => {
    const first = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
    });
    h.clock.advanceMinutes(2);
    const second = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要提高商务英语口语',
    });
    await updateGoal(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      goalId: first.goal.id,
      status: 'paused',
    });

    expect((await h.ctx.repos.goals.findById(first.goal.id))?.isPrimary).toBe(false);
    expect(await h.ctx.repos.goals.findPrimary(LOCAL_LEARNER_ID)).toMatchObject({
      id: second.goal.id,
      isPrimary: true,
      priority: 1,
    });
  });
});

describe('M6: scenario lifecycle and bindings', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('creates a goal-bound tree, updates it, and protects a parent with children', async () => {
    const { goal } = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备出国旅行英语',
    });
    const big = await createScenario(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      name: '下周出国旅行',
      type: 'big',
      goalId: goal.id,
      timePreset: 'next_week',
      timeText: '下周三出发',
    });
    const child = await createScenario(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      name: '饭店点餐',
      type: 'small',
      goalId: goal.id,
      parentId: big.id,
    });

    expect(big.timeContext).toMatchObject({ preset: 'next_week', freeText: '下周三出发' });
    expect(child.parentId).toBe(big.id);
    await expect(deleteScenario(h.ctx, LOCAL_LEARNER_ID, big.id)).rejects.toThrow('请先删除');
    const updated = await updateScenario(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      scenarioId: child.id,
      name: '餐厅点餐与结账',
      goalId: null,
      status: 'done',
    });
    expect(updated).toMatchObject({ name: '餐厅点餐与结账', goalId: null, status: 'done' });
    await deleteScenario(h.ctx, LOCAL_LEARNER_ID, child.id);
    await deleteScenario(h.ctx, LOCAL_LEARNER_ID, big.id);
    expect(await h.ctx.repos.scenarios.listByLearner(LOCAL_LEARNER_ID)).toHaveLength(0);
  });

  it('auto-archives expired scenarios and records lifecycle event/log once', async () => {
    const scenario = await createScenario(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      name: '今天面试',
      type: 'big',
      timePreset: 'today',
    });
    h.clock.advanceDays(2);
    const first = await listScenarios(h.ctx, LOCAL_LEARNER_ID);
    expect(first.find((entry) => entry.id === scenario.id)?.status).toBe('done');
    const eventsAfterFirst = await h.ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(eventsAfterFirst.filter((event) => event.type === 'scenario_archived')).toHaveLength(1);
    const logsAfterFirst = await h.ctx.repos.operationLog.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(logsAfterFirst.some((log) => log.note?.includes('自动归档'))).toBe(true);

    await listScenarios(h.ctx, LOCAL_LEARNER_ID);
    const eventsAfterSecond = await h.ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(eventsAfterSecond.filter((event) => event.type === 'scenario_archived')).toHaveLength(1);
  });

  it('binds and unbinds an imported wordlist to an owned goal', async () => {
    const { goal } = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
    });
    const now = h.clock.nowIso();
    const wordlist: Wordlist = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      name: '雅思词库',
      languageCode: 'en',
      goalId: null,
      tags: [],
      sourceFile: 'ielts.csv',
      itemCount: 100,
      createdAt: now,
      updatedAt: now,
    };
    await h.ctx.repos.wordlists.create(wordlist);

    expect(
      await bindWordlistToGoal(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        wordlistId: wordlist.id,
        goalId: goal.id,
      }),
    ).toMatchObject({ goalId: goal.id });
    expect(
      await bindWordlistToGoal(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        wordlistId: wordlist.id,
        goalId: null,
      }),
    ).toMatchObject({ goalId: null });
  });

  it('rejects a small scenario without an owned big parent', async () => {
    await expect(
      createScenario(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        name: '问路',
        type: 'small',
      }),
    ).rejects.toThrow('小场景必须选择所属大场景');
  });
});
