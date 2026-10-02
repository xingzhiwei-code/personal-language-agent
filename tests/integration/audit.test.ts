import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  updateKnowledgeItem,
} from '@/application/knowledge';
import { createTestHarness, LOCAL_LEARNER_ID, type TestHarness } from '../helpers/context';

describe('M3: knowledge operation audit trail', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('records manual create, update and delete with snapshots and field diffs', async () => {
    const { item } = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'audit me',
      meaning: '初始释义',
    });
    h.clock.advanceMinutes(1);
    await updateKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      id: item.id,
      meaning: '更新释义',
      tags: ['audit'],
    });
    h.clock.advanceMinutes(1);
    await deleteKnowledgeItem(h.ctx, LOCAL_LEARNER_ID, item.id);

    const logs = await h.ctx.repos.operationLog.listByItem(LOCAL_LEARNER_ID, item.id, 10);
    expect(logs.map((log) => log.operation)).toEqual(['delete', 'update', 'create']);
    expect(logs[1]?.changes).toEqual({
      meaning: ['初始释义', '更新释义'],
      tags: [[], ['audit']],
    });
    expect(logs[0]).toMatchObject({ itemText: 'audit me', source: 'manual' });
    expect(await h.ctx.repos.knowledge.findById(item.id)).toBeNull();
  });

  it('filters logs by operation type without mixing learning events', async () => {
    const { item } = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'separate audit',
    });
    await updateKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      id: item.id,
      notes: 'changed',
    });

    const creates = await h.ctx.repos.operationLog.listByLearner(
      LOCAL_LEARNER_ID,
      20,
      0,
      ['create'],
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]?.knowledgeItemId).toBe(item.id);
    expect(await h.ctx.repos.events.countByLearner(LOCAL_LEARNER_ID)).toBe(2);
    expect(await h.ctx.repos.operationLog.countByLearner(LOCAL_LEARNER_ID)).toBe(2);
  });

  it('does not add an audit row for a no-op duplicate create', async () => {
    await createKnowledgeItem(h.ctx, { learnerId: LOCAL_LEARNER_ID, text: 'same' });
    const duplicate = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: ' SAME ',
    });

    expect(duplicate.deduplicated).toBe(true);
    expect(await h.ctx.repos.operationLog.countByLearner(LOCAL_LEARNER_ID)).toBe(1);
  });
});
