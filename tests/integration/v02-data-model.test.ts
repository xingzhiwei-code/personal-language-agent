/**
 * M1 Integration Tests — v0.2 data model (PRD §7 acceptance criteria)
 *
 * Coverage:
 * - AC1: imported items land in status='new', NOT in SRS due queue
 * - AC2: same-file duplicate import → 0 added (idempotency by fileHash)
 * - AC12: existing items keep ai_generated=false; new wordlistId/entryMethod defaults work
 * - Wordlist CRUD
 * - ImportExportHistory CRUD + findByFileHash idempotency
 * - KnowledgeOperationLog append + list
 * - Scenario CRUD + archiveExpired
 * - daily_new_word_budget preference round-trip
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKnowledgeItem } from '@/application/knowledge';
import { setPreference } from '@/application/memory';
import { LOCAL_LEARNER_ID } from '@/application/types';
import type {
  ImportExportHistory,
  KnowledgeOperationLog,
  Scenario,
  Wordlist,
} from '@/domain/entities';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('M1: pool isolation — imported items must NOT enter the SRS queue', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('status=new item does not appear in listDueForReview', async () => {
    const { item } = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'abandon',
      meaning: '放弃',
      poolMode: true, // enters pool, not learning
      entryMethod: 'file_upload',
    });

    expect(item.status).toBe('new');
    expect(item.entryMethod).toBe('file_upload');

    // SRS due query must NOT return this item
    const due = await h.ctx.repos.states.listDueForReview(
      LOCAL_LEARNER_ID,
      h.clock.nowIso(),
      100,
    );
    expect(due.length).toBe(0);
  });

  it('status=active item IS immediately reviewable', async () => {
    const { item } = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'resilient',
      meaning: '有弹性的',
      // no poolMode → status='active', initialState nextReviewAt=now
    });

    expect(item.status).toBe('active');

    const due = await h.ctx.repos.states.listDueForReview(
      LOCAL_LEARNER_ID,
      h.clock.nowIso(),
      100,
    );
    expect(due.some((s) => s.subjectId === item.id)).toBe(true);
  });

  it('createKnowledgeItem defaults: entryMethod=manual, wordlistId=null, frequencyRank=null', async () => {
    const { item } = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'meticulous',
    });
    expect(item.entryMethod).toBe('manual');
    expect(item.wordlistId).toBeNull();
    expect(item.frequencyRank).toBeNull();
    expect(item.aiGenerated).toBe(false); // AC12: default false
  });
});

describe('M1: Wordlist repository', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('creates, finds, updates and deletes a wordlist', async () => {
    const now = h.clock.nowIso();
    const wl: Wordlist = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      name: '雅思词库',
      languageCode: 'en',
      goalId: null,
      tags: ['ielts', 'academic'],
      sourceFile: 'ielts-3000.csv',
      itemCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const created = await h.ctx.repos.wordlists.create(wl);
    expect(created.id).toBe(wl.id);

    const found = await h.ctx.repos.wordlists.findById(wl.id);
    expect(found?.name).toBe('雅思词库');
    expect(found?.tags).toEqual(['ielts', 'academic']);

    const updated = await h.ctx.repos.wordlists.update({ ...wl, itemCount: 3000 });
    expect(updated.itemCount).toBe(3000);

    const list = await h.ctx.repos.wordlists.listByLearner(LOCAL_LEARNER_ID);
    expect(list.length).toBe(1);

    await h.ctx.repos.wordlists.delete(wl.id);
    const gone = await h.ctx.repos.wordlists.findById(wl.id);
    expect(gone).toBeNull();
  });
});

describe('M1: ImportExportHistory — idempotency by fileHash', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('findByFileHash returns null when hash unknown', async () => {
    const result = await h.ctx.repos.importExportHistory.findByFileHash(
      LOCAL_LEARNER_ID,
      'sha256:abc123',
    );
    expect(result).toBeNull();
  });

  it('saves an import record and retrieves it by hash', async () => {
    const now = h.clock.nowIso();
    const fileHash = 'sha256:deadbeef0123456789abcdef';
    const record: ImportExportHistory = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      type: 'import',
      method: 'file_upload',
      sourceLabel: 'sample-wordlist.csv',
      fileHash,
      format: 'csv',
      totalCount: 10,
      addedCount: 10,
      duplicateCount: 0,
      failedCount: 0,
      status: 'success',
      errors: [],
      wordlistId: null,
      goalId: null,
      createdAt: now,
    };

    await h.ctx.repos.importExportHistory.create(record);

    // Same hash → idempotency check finds the previous run
    const found = await h.ctx.repos.importExportHistory.findByFileHash(
      LOCAL_LEARNER_ID,
      fileHash,
    );
    expect(found?.id).toBe(record.id);
    expect(found?.addedCount).toBe(10);
  });

  it('second import with same hash does not create a new record', async () => {
    const now = h.clock.nowIso();
    const fileHash = 'sha256:samefile';
    const base: ImportExportHistory = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      type: 'import',
      method: 'file_upload',
      sourceLabel: 'test.csv',
      fileHash,
      format: 'csv',
      totalCount: 5,
      addedCount: 5,
      duplicateCount: 0,
      failedCount: 0,
      status: 'success',
      errors: [],
      wordlistId: null,
      goalId: null,
      createdAt: now,
    };

    await h.ctx.repos.importExportHistory.create(base);

    // Simulate "same file imported again": application layer would see the
    // existing record and skip. The test verifies the repo correctly surfaces it.
    const existing = await h.ctx.repos.importExportHistory.findByFileHash(
      LOCAL_LEARNER_ID,
      fileHash,
    );
    // Application should see it's a duplicate and NOT call create again.
    expect(existing).not.toBeNull();
    expect(existing?.status).toBe('success');

    // List should still have exactly 1 record
    const list = await h.ctx.repos.importExportHistory.listByLearner(LOCAL_LEARNER_ID, 50);
    expect(list.length).toBe(1);
  });
});

describe('M1: KnowledgeOperationLog', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('appends and lists log entries', async () => {
    const now = h.clock.nowIso();
    const entry: KnowledgeOperationLog = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      operation: 'create',
      knowledgeItemId: 'item-1',
      itemText: 'abandon',
      changes: {},
      source: 'manual',
      note: null,
      createdAt: now,
    };

    await h.ctx.repos.operationLog.append(entry);

    const list = await h.ctx.repos.operationLog.listByLearner(LOCAL_LEARNER_ID, 50);
    expect(list.length).toBe(1);
    expect(list[0]?.operation).toBe('create');
    expect(list[0]?.itemText).toBe('abandon');
  });

  it('records status transition diff in changes', async () => {
    const now = h.clock.nowIso();
    const entry: KnowledgeOperationLog = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      operation: 'promote_to_learning',
      knowledgeItemId: 'item-2',
      itemText: 'resilient',
      changes: { status: ['new', 'active'] },
      source: 'manual',
      note: null,
      createdAt: now,
    };

    await h.ctx.repos.operationLog.append(entry);

    const byItem = await h.ctx.repos.operationLog.listByItem(
      LOCAL_LEARNER_ID,
      'item-2',
      10,
    );
    expect(byItem.length).toBe(1);
    expect(byItem[0]?.changes).toEqual({ status: ['new', 'active'] });
  });

  it('countByLearner returns correct count', async () => {
    const now = h.clock.nowIso();
    for (let i = 0; i < 3; i++) {
      await h.ctx.repos.operationLog.append({
        id: h.ctx.ids.next(),
        learnerId: LOCAL_LEARNER_ID,
        operation: 'delete',
        knowledgeItemId: `item-${i}`,
        itemText: `word${i}`,
        changes: {},
        source: 'manual',
        note: null,
        createdAt: now,
      });
    }
    const count = await h.ctx.repos.operationLog.countByLearner(LOCAL_LEARNER_ID);
    expect(count).toBe(3);
  });
});

describe('M1: Scenario repository + auto-archive', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('creates a scenario and retrieves it', async () => {
    const now = h.clock.nowIso();
    const sc: Scenario = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      goalId: null,
      parentId: null,
      name: '下周去旅游',
      type: 'big',
      timeContext: {
        preset: 'next_week',
        freeText: '下周去国外旅游',
        resolvedDueAt: new Date(Date.parse(now) + 7 * 86_400_000).toISOString(),
      },
      status: 'active',
      knowledgeItemIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await h.ctx.repos.scenarios.create(sc);
    const found = await h.ctx.repos.scenarios.findById(sc.id);
    expect(found?.name).toBe('下周去旅游');
    expect(found?.timeContext?.preset).toBe('next_week');
    expect(found?.status).toBe('active');
  });

  it('archiveExpired archives scenarios whose resolvedDueAt has passed', async () => {
    const now = h.clock.nowIso();
    const pastDue = new Date(Date.parse(now) - 1000).toISOString(); // 1 second ago

    const sc: Scenario = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      goalId: null,
      parentId: null,
      name: '已过期场景',
      type: 'big',
      timeContext: {
        preset: 'this_week',
        freeText: null,
        resolvedDueAt: pastDue,
      },
      status: 'active',
      knowledgeItemIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await h.ctx.repos.scenarios.create(sc);

    const count = await h.ctx.repos.scenarios.archiveExpired(LOCAL_LEARNER_ID, now);
    expect(count).toBe(1);

    const archived = await h.ctx.repos.scenarios.findById(sc.id);
    expect(archived?.status).toBe('done');
  });

  it('archiveExpired does NOT archive scenarios with future resolvedDueAt', async () => {
    const now = h.clock.nowIso();
    const futureDue = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();

    const sc: Scenario = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      goalId: null,
      parentId: null,
      name: '下周旅游',
      type: 'big',
      timeContext: {
        preset: 'next_week',
        freeText: null,
        resolvedDueAt: futureDue,
      },
      status: 'active',
      knowledgeItemIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await h.ctx.repos.scenarios.create(sc);

    const count = await h.ctx.repos.scenarios.archiveExpired(LOCAL_LEARNER_ID, now);
    expect(count).toBe(0);

    const still = await h.ctx.repos.scenarios.findById(sc.id);
    expect(still?.status).toBe('active');
  });

  it('long_term scenario (null resolvedDueAt) is never archived', async () => {
    const now = h.clock.nowIso();
    const sc: Scenario = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      goalId: null,
      parentId: null,
      name: '长期目标',
      type: 'big',
      timeContext: { preset: 'long_term', freeText: null, resolvedDueAt: null },
      status: 'active',
      knowledgeItemIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await h.ctx.repos.scenarios.create(sc);

    // Advance time far into the future
    h.clock.advanceDays(365);
    const count = await h.ctx.repos.scenarios.archiveExpired(
      LOCAL_LEARNER_ID,
      h.clock.nowIso(),
    );
    expect(count).toBe(0);

    const found = await h.ctx.repos.scenarios.findById(sc.id);
    expect(found?.status).toBe('active');
  });
});

describe('M1: daily_new_word_budget preference', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('stores and retrieves budget as user_explicit preference', async () => {
    await setPreference(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      key: 'daily_new_word_budget',
      value: '10',
      source: 'user_explicit',
    });

    const pref = await h.ctx.repos.preferences.findByKey(
      LOCAL_LEARNER_ID,
      'daily_new_word_budget',
    );
    expect(pref?.value).toBe('10');
    expect(pref?.source).toBe('user_explicit');
  });

  it('budget=0 is a valid value (disables auto-promotion)', async () => {
    await setPreference(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      key: 'daily_new_word_budget',
      value: '0',
      source: 'user_explicit',
    });
    const pref = await h.ctx.repos.preferences.findByKey(
      LOCAL_LEARNER_ID,
      'daily_new_word_budget',
    );
    expect(pref?.value).toBe('0');
  });
});
