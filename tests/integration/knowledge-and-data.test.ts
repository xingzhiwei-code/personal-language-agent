import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DELETE_CONFIRMATION_PHRASE,
  deleteLearnerData,
  exportLearnerData,
  saveExportToStorage,
} from '@/application/data-management';
import { recordFeedback } from '@/application/feedback';
import { createGoalFromText } from '@/application/goals';
import {
  addKnowledgeRelation,
  createKnowledgeItem,
  getKnowledgeDetail,
  listKnowledge,
  updateKnowledgeItem,
} from '@/application/knowledge';
import { saveMemory } from '@/application/memory';
import { recordTransferEvidence } from '@/application/transfer';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('knowledge graph and provenance', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => harness.cleanup());

  it('keeps "figure" and "figure out" as separate items', async () => {
    const word = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure',
      meaning: '数字/人物',
    });
    const phrase = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
    });

    expect(word.item.type).toBe('word');
    expect(phrase.item.type).toBe('phrase');
    expect(word.item.id).not.toBe(phrase.item.id);

    const relation = await addKnowledgeRelation(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      fromItemId: phrase.item.id,
      toItemId: word.item.id,
      type: 'derived_from',
    });
    expect(relation.type).toBe('derived_from');

    const detail = await getKnowledgeDetail(harness.ctx, LOCAL_LEARNER_ID, phrase.item.id);
    expect(detail.relations).toHaveLength(1);
    expect(detail.relations[0]?.other.text).toBe('figure');

    // Adding the same relation twice does not duplicate it.
    await addKnowledgeRelation(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      fromItemId: phrase.item.id,
      toItemId: word.item.id,
      type: 'derived_from',
    });
    const again = await getKnowledgeDetail(harness.ctx, LOCAL_LEARNER_ID, phrase.item.id);
    expect(again.relations).toHaveLength(1);
  });

  it('marks AI-generated entries distinctly from user content', async () => {
    const mine = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'run into',
      meaning: '偶遇',
      origin: 'user',
      sourceType: 'user_manual',
    });
    const generated = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'bump into',
      meaning: '撞见',
      aiGenerated: true,
    });

    expect(mine.item.aiGenerated).toBe(false);
    expect(mine.item.origin).toBe('user');
    expect(generated.item.aiGenerated).toBe(true);
    expect(generated.item.origin).toBe('ai_generated');
    expect(generated.item.sourceType).toBe('ai_generated');
  });

  it('de-duplicates identical entries and enriches missing meaning', async () => {
    const first = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'hold on',
    });
    const second = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'Hold On',
      meaning: '等一下',
    });

    expect(second.deduplicated).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.meaning).toBe('等一下');
  });

  it('lets the user mark an item as known or irrelevant', async () => {
    const { item } = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'put off',
      meaning: '推迟',
    });

    const known = await recordFeedback(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      kind: 'already_known',
      subjectType: 'knowledge_item',
      subjectId: item.id,
    });
    expect(known.item?.status).toBe('user_mastered');
    expect(known.state?.userDeclaredMastered).toBe(true);

    const { item: other } = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'asdfqwer',
    });
    const irrelevant = await recordFeedback(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      kind: 'not_relevant',
      subjectType: 'knowledge_item',
      subjectId: other.id,
    });
    expect(irrelevant.item?.status).toBe('irrelevant');
    expect(irrelevant.state?.nextReviewAt).toBeNull();

    const active = await listKnowledge(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      statuses: ['active'],
    });
    expect(active.items).toHaveLength(0);
  });

  it('rejects a conflicting rename', async () => {
    const a = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'give up',
      meaning: '放弃',
    });
    await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'give in',
      meaning: '屈服',
    });

    await expect(
      updateKnowledgeItem(harness.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        id: a.item.id,
        text: 'give in',
      }),
    ).rejects.toThrow();
  });
});

describe('transfer evidence', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => harness.cleanup());

  it('is tracked separately from in-app mastery', async () => {
    const { item } = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'catch up',
      meaning: '赶上',
    });

    const before = await harness.ctx.repos.states.find(
      LOCAL_LEARNER_ID,
      'knowledge_item',
      item.id,
    );
    expect(before?.transferScore).toBeNull();

    const { state } = await recordTransferEvidence(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      subjectType: 'knowledge_item',
      subjectId: item.id,
      scenario: '和同事开会时用上了',
      evidenceType: 'self_report',
      score: 0.8,
    });

    expect(state.transferScore).toBeCloseTo(0.8, 5);
    // A self-report gives limited confidence, and mastery stays untouched.
    expect(state.transferConfidence).toBeLessThan(0.5);
    expect(state.mastery).toBe(0);
  });
});

describe('data management', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = createTestHarness();
    await createGoalFromText(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语口语',
    });
    await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
    });
    await saveMemory(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      key: 'test_memory',
      kind: 'fact',
      content: '喜欢用真实工作场景练习',
      source: 'user_explicit',
    });
  });

  afterEach(() => harness.cleanup());

  it('exports readable JSON with all learner data', async () => {
    const data = await exportLearnerData(harness.ctx, LOCAL_LEARNER_ID);
    expect(data.formatVersion).toBe(1);
    expect(data.goals).toHaveLength(1);
    expect(data.knowledgeItems).toHaveLength(1);
    expect(data.memories).toHaveLength(1);
    expect(data.learningEvents.length).toBeGreaterThan(0);
    expect(data.notice).toContain('本机');

    // No secrets are ever part of the export.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('LLA_LLM_API_KEY');
    expect(serialized.toLowerCase()).not.toContain('"apikey"');
  });

  it('writes the export through the ObjectStorage port', async () => {
    const { key, bytes } = await saveExportToStorage(harness.ctx, LOCAL_LEARNER_ID);
    expect(bytes).toBeGreaterThan(0);
    const stored = await harness.ctx.storage.getText(key);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).learnerId).toBe(LOCAL_LEARNER_ID);
    expect(await harness.ctx.storage.exists(key)).toBe(true);
  });

  it('requires the confirmation phrase before deleting', async () => {
    await expect(
      deleteLearnerData(harness.ctx, LOCAL_LEARNER_ID, '删除'),
    ).rejects.toThrow();

    const stillThere = await listKnowledge(harness.ctx, { learnerId: LOCAL_LEARNER_ID });
    expect(stillThere.items).toHaveLength(1);
  });

  it('deletes everything local when confirmed and stays usable', async () => {
    await saveExportToStorage(harness.ctx, LOCAL_LEARNER_ID);
    await deleteLearnerData(harness.ctx, LOCAL_LEARNER_ID, DELETE_CONFIRMATION_PHRASE);

    expect(await harness.ctx.repos.goals.listByLearner(LOCAL_LEARNER_ID)).toHaveLength(0);
    expect((await listKnowledge(harness.ctx, { learnerId: LOCAL_LEARNER_ID })).items).toHaveLength(
      0,
    );
    expect(await harness.ctx.repos.memories.listByLearner(LOCAL_LEARNER_ID)).toHaveLength(0);
    expect(await harness.ctx.repos.events.listByLearner(LOCAL_LEARNER_ID, 10)).toHaveLength(0);
    expect(await harness.ctx.repos.operationLog.listByLearner(LOCAL_LEARNER_ID, 10)).toHaveLength(0);
    expect(await harness.ctx.storage.list(`exports/${LOCAL_LEARNER_ID}`)).toHaveLength(0);

    // The learner row is recreated so the app keeps working.
    expect(await harness.ctx.repos.users.findById(LOCAL_LEARNER_ID)).not.toBeNull();

    // And a new goal can be created right away.
    const again = await createGoalFromText(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想练英语写作',
    });
    expect(again.goal.isPrimary).toBe(true);
  });

  it('protects the local storage root against path traversal', async () => {
    await expect(harness.ctx.storage.put('../../escape.json', 'x')).rejects.toThrow();
    await expect(harness.ctx.storage.put('/etc/passwd', 'x')).resolves.toBeTruthy();
    // The absolute-looking key is stored INSIDE the root, not at /etc.
    expect(await harness.ctx.storage.exists('etc/passwd')).toBe(true);
  });
});
