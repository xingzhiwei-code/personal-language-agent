import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replaceDailyPlan, restDailyPlan, resumeDailyPlan } from '@/application/daily-plan';
import { createGoalFromText } from '@/application/goals';
import { executeFileImport } from '@/application/importer';
import {
  ensureDailyPoolPromotion,
  pauseKnowledgeItems,
  promoteKnowledgeItems,
} from '@/application/knowledge-pool';
import { setPreference } from '@/application/memory';
import { generateRecommendations } from '@/application/recommendations';
import { startSession } from '@/application/sessions';
import { createKnowledgeItem } from '@/application/knowledge';
import { getHomeView } from '@/application/home';
import { createTestHarness, LOCAL_LEARNER_ID, type TestHarness } from '../helpers/context';

describe('M7: daily pool promotion and manual flow', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('uses the daily budget atomically and selects at least 80% from a sufficiently large primary-bound wordlist', async () => {
    const { goal } = await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要准备雅思考试',
    });
    await importWords(h, 'bound.csv', 'bound-list', words('ielts', 15), goal.id);
    await importWords(h, 'generic.csv', 'generic-list', words('generic', 15), null);

    const [first, concurrent] = await Promise.all([
      ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID),
      ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID),
    ]);
    const promoted = [...first.promoted, ...concurrent.promoted];
    expect(promoted).toHaveLength(10);
    const boundWordlist = (await h.ctx.repos.wordlists.listByLearner(LOCAL_LEARNER_ID)).find(
      (wordlist) => wordlist.name === 'bound-list',
    );
    expect(promoted.filter((item) => item.wordlistId === boundWordlist?.id).length / promoted.length).toBeGreaterThanOrEqual(0.8);
    expect(promoted.every((item) => item.status === 'active')).toBe(true);
    expect(
      await h.ctx.repos.states.listDueForReview(LOCAL_LEARNER_ID, h.clock.nowIso(), 100),
    ).toHaveLength(10);
    const events = await h.ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(events.filter((event) => event.type === 'knowledge_pool_promoted')).toHaveLength(1);
    const logs = await h.ctx.repos.operationLog.listByLearner(LOCAL_LEARNER_ID, 100);
    expect(logs.filter((log) => log.operation === 'promote_to_learning')).toHaveLength(10);
    expect(first.reason ?? concurrent.reason).toContain('主目标绑定词库');
  });

  it('resets the automatic budget on the next UTC day and budget zero disables only automatic promotion', async () => {
    await importWords(h, 'pool.csv', 'pool', words('daily', 20), null);
    await setPreference(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      key: 'daily_new_word_budget',
      value: '3',
      source: 'user_explicit',
    });
    expect((await ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID)).promoted).toHaveLength(3);
    expect((await ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID)).promoted).toHaveLength(0);
    h.clock.advanceDays(1);
    expect((await ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID)).promoted).toHaveLength(3);
    h.clock.advanceDays(1);
    expect((await ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID)).promoted).toHaveLength(3);

    await setPreference(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      key: 'daily_new_word_budget',
      value: '0',
      source: 'user_explicit',
    });
    h.clock.advanceDays(1);
    expect((await ensureDailyPoolPromotion(h.ctx, LOCAL_LEARNER_ID)).promoted).toHaveLength(0);
    const pool = await h.ctx.repos.knowledge.search({ learnerId: LOCAL_LEARNER_ID, statuses: ['new'], limit: 1 });
    expect(await promoteKnowledgeItems(h.ctx, { learnerId: LOCAL_LEARNER_ID, itemIds: [pool[0]!.id] })).toHaveLength(1);
  });

  it('manual promotion is idempotent and pause-to-pool keeps evidence but leaves the due queue', async () => {
    const created = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'pool-flow',
      meaning: '流转',
      poolMode: true,
    });
    expect(await promoteKnowledgeItems(h.ctx, { learnerId: LOCAL_LEARNER_ID, itemIds: [created.item.id] })).toHaveLength(1);
    expect(await promoteKnowledgeItems(h.ctx, { learnerId: LOCAL_LEARNER_ID, itemIds: [created.item.id] })).toHaveLength(0);
    const stateBefore = await h.ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', created.item.id);
    expect(stateBefore).not.toBeNull();
    expect(await pauseKnowledgeItems(h.ctx, { learnerId: LOCAL_LEARNER_ID, itemIds: [created.item.id] })).toHaveLength(1);
    const stateAfter = await h.ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', created.item.id);
    expect(stateAfter?.id).toBe(stateBefore?.id);
    expect(stateAfter?.nextReviewAt).toBeNull();
    expect(await h.ctx.repos.states.listDueForReview(LOCAL_LEARNER_ID, h.clock.nowIso(), 10)).toHaveLength(0);
  });
});

describe('M7: daily plan behavior', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = createTestHarness();
    await createGoalFromText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我要提高英语综合能力',
    });
  });
  afterEach(() => h.cleanup());

  it('starts a recommendation with the exact preferred subject IDs first', async () => {
    await importWords(h, 'plan.csv', 'plan-list', words('plan', 4), null);
    await setPreference(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      key: 'daily_new_word_budget',
      value: '4',
      source: 'user_explicit',
    });
    const bundle = await generateRecommendations(h.ctx, LOCAL_LEARNER_ID, 3);
    const recommendation = bundle.recommendations.find(
      (entry) => entry.activityType === 'quick_review' || entry.activityType === 'vocabulary_recall',
    );
    expect(recommendation?.subjectIds.length).toBeGreaterThan(0);

    const started = await startSession(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: recommendation!.activityType,
      recommendationId: recommendation!.id,
      plannedDurationMinutes: 50,
      clientToken: 'daily-plan-session',
    });
    expect(started.session.plannedDurationMinutes).toBe(recommendation?.plannedDurationMinutes);
    expect(started.activities.map((activity) => activity.subjectId)).toEqual(
      recommendation!.subjectIds.slice(0, recommendation!.estimatedItemCount),
    );
  });

  it('atomically allows only one session to claim an offered recommendation', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'single-claim',
      meaning: '只领取一次',
    });
    const bundle = await generateRecommendations(h.ctx, LOCAL_LEARNER_ID, 1);
    const recommendation = bundle.recommendations[0]!;
    const attempts = await Promise.allSettled([
      startSession(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        activityType: recommendation.activityType,
        recommendationId: recommendation.id,
        clientToken: 'claim-a',
      }),
      startSession(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        activityType: recommendation.activityType,
        recommendationId: recommendation.id,
        clientToken: 'claim-b',
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(await h.ctx.repos.sessions.listByLearner(LOCAL_LEARNER_ID, 10)).toHaveLength(1);
    expect(await h.ctx.repos.events.listBySession(
      (await h.ctx.repos.sessions.listByLearner(LOCAL_LEARNER_ID, 10))[0]!.id,
    )).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'session_started' })]));
  });

  it('rejects an entire batch and deterministically excludes its task subjects', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'word-one',
      meaning: '词一',
      examples: [{ text: 'A word one example.', origin: 'user' }],
    });
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'grammar pattern',
      type: 'grammar',
      meaning: '语法结构',
    });
    const first = await generateRecommendations(h.ctx, LOCAL_LEARNER_ID, 2);
    const excludedSubjects = new Set(first.recommendations.flatMap((entry) => entry.subjectIds));
    const excludedSubjectlessActivities = new Set(
      first.recommendations
        .filter((entry) => entry.subjectIds.length === 0)
        .map((entry) => entry.activityType),
    );
    const replacement = await replaceDailyPlan(
      h.ctx,
      LOCAL_LEARNER_ID,
      first.recommendations.map((entry) => entry.id),
    );
    expect(replacement.length).toBeGreaterThan(0);
    expect(
      replacement.every(
        (entry) =>
          entry.subjectIds.every((id) => !excludedSubjects.has(id)) &&
          !excludedSubjectlessActivities.has(entry.activityType),
      ),
    ).toBe(true);
    const rejected = await Promise.all(
      first.recommendations.map((entry) => h.ctx.repos.recommendations.findById(entry.id)),
    );
    expect(rejected.every((entry) => entry?.status === 'rejected')).toBe(true);
  });

  it('today rest suppresses recommendations, can resume, and automatically expires next day', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'rest-test',
      meaning: '休息测试',
    });
    await restDailyPlan(h.ctx, LOCAL_LEARNER_ID);
    const resting = await getHomeView(h.ctx, LOCAL_LEARNER_ID);
    expect(resting.restingToday).toBe(true);
    expect(resting.primary).toBeNull();

    await resumeDailyPlan(h.ctx, LOCAL_LEARNER_ID);
    const resumed = await getHomeView(h.ctx, LOCAL_LEARNER_ID);
    expect(resumed.restingToday).toBe(false);
    expect(resumed.primary).not.toBeNull();

    await restDailyPlan(h.ctx, LOCAL_LEARNER_ID);
    h.clock.advanceDays(1);
    const tomorrow = await getHomeView(h.ctx, LOCAL_LEARNER_ID);
    expect(tomorrow.restingToday).toBe(false);
    expect(tomorrow.primary).not.toBeNull();
  });
});

async function importWords(
  h: TestHarness,
  fileName: string,
  wordlistName: string,
  entries: { word: string; definition: string }[],
  goalId: string | null,
) {
  return executeFileImport(h.ctx, {
    learnerId: LOCAL_LEARNER_ID,
    fileName,
    fileHash: `sha256:${fileName}`,
    format: 'json',
    content: JSON.stringify(entries),
    wordlistName,
    languageCode: 'en',
    goalId,
  });
}

function words(prefix: string, count: number): { word: string; definition: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    word: `${prefix}-${String(index).padStart(2, '0')}`,
    definition: `${prefix} ${index}`,
  }));
}
