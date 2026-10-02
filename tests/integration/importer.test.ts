import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeFileImport,
  parseWordlist,
  previewFileImport,
} from '@/application/importer';
import { createKnowledgeItem, listKnowledge } from '@/application/knowledge';
import type { Goal } from '@/domain/entities';
import { createTestHarness, LOCAL_LEARNER_ID, type TestHarness } from '../helpers/context';

describe('M2: deterministic wordlist parsers', () => {
  it('parses RFC-style CSV fields including quoted commas', () => {
    const parsed = parseWordlist(
      'word,phonetic,pos,definition,example\n"break down",,phr.,"分解, 分析","Break it down, please."',
      'csv',
    );
    expect(parsed.totalCount).toBe(1);
    expect(parsed.entries[0]).toMatchObject({
      row: 2,
      word: 'break down',
      pos: 'phr.',
      definition: '分解, 分析',
      example: 'Break it down, please.',
    });
  });

  it('parses JSON and reports invalid rows without discarding valid rows', () => {
    const parsed = parseWordlist(
      JSON.stringify([{ word: 'resilient', definition: '有韧性的' }, 'bad', { word: '' }]),
      'json',
    );
    expect(parsed.totalCount).toBe(3);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.errors).toEqual([
      { row: 2, reason: 'word 不能为空' },
      { row: 3, reason: 'word 不能为空' },
    ]);
  });

  it('parses non-empty TXT lines and keeps their source line numbers', () => {
    const parsed = parseWordlist('alpha\n\n beta \n', 'txt');
    expect(parsed.entries.map((entry) => [entry.row, entry.word])).toEqual([
      [1, 'alpha'],
      [3, 'beta'],
    ]);
  });

  it('rejects unsupported or oversized input', () => {
    expect(() => parseWordlist('not json', 'json')).toThrow('JSON 格式无效');
    expect(() => parseWordlist(`word\n${Array.from({ length: 20_001 }, (_, i) => `w${i}`).join('\n')}`, 'csv')).toThrow(
      '单次最多导入 20000 条',
    );
  });
});

describe('M2: file import workflow', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('previews existing and in-file duplicates without writing data', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'Alpha',
      languageCode: 'en',
    });
    const content = 'word,definition\nalpha,A\n ALPHA ,A2\nbeta,B';
    const preview = await previewFileImport(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      fileName: 'sample.csv',
      fileHash: 'sha256:preview',
      format: 'csv',
      content,
      languageCode: 'en',
    });

    expect(preview).toMatchObject({
      totalCount: 3,
      validCount: 3,
      estimatedAddedCount: 1,
      duplicateCount: 2,
      failedCount: 0,
      duplicateFile: false,
    });
    expect(await h.ctx.repos.wordlists.listByLearner(LOCAL_LEARNER_ID)).toHaveLength(0);
  });

  it('atomically imports to pool, binds goal, records history/logs, and is file-idempotent', async () => {
    const now = h.clock.nowIso();
    const goal: Goal = {
      id: h.ctx.ids.next(),
      learnerId: LOCAL_LEARNER_ID,
      languageCode: 'en',
      title: '雅思 7 分',
      rawInput: '雅思 7 分',
      description: null,
      scenarios: [],
      status: 'active',
      priority: 1,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    };
    await h.ctx.repos.goals.create(goal);
    const content = 'word,phonetic,pos,definition,example\nAlpha,,n.,甲,Alpha example.\n alpha ,,n.,重复,\nbeta,,n.,乙,Beta example.\n,missing,,,bad';
    const input = {
      learnerId: LOCAL_LEARNER_ID,
      fileName: 'ielts.csv',
      fileHash: 'sha256:idempotent-file',
      format: 'csv' as const,
      content,
      wordlistName: '雅思核心词',
      languageCode: 'en',
      goalId: goal.id,
    };

    const first = await executeFileImport(h.ctx, input);
    expect(first).toMatchObject({
      duplicateFile: false,
      totalCount: 4,
      addedCount: 2,
      duplicateCount: 1,
      failedCount: 1,
    });

    const pool = await h.ctx.repos.knowledge.search({
      learnerId: LOCAL_LEARNER_ID,
      statuses: ['new'],
      limit: 10,
    });
    expect(pool).toHaveLength(2);
    expect(pool.every((item) => item.wordlistId === first.wordlistId)).toBe(true);
    expect(pool.every((item) => item.aiGenerated === false && item.entryMethod === 'file_upload')).toBe(true);
    expect(await h.ctx.repos.states.listDueForReview(LOCAL_LEARNER_ID, now, 100)).toHaveLength(0);

    const wordlists = await h.ctx.repos.wordlists.listByLearner(LOCAL_LEARNER_ID);
    expect(wordlists).toHaveLength(1);
    expect(wordlists[0]).toMatchObject({ itemCount: 2, goalId: goal.id });
    const history = await h.ctx.repos.importExportHistory.listByLearner(LOCAL_LEARNER_ID, 10);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'partial', addedCount: 2, duplicateCount: 1, failedCount: 1 });
    expect(await h.ctx.repos.operationLog.countByLearner(LOCAL_LEARNER_ID)).toBe(2);

    const second = await executeFileImport(h.ctx, input);
    expect(second).toMatchObject({ duplicateFile: true, addedCount: 0, duplicateCount: 3 });
    expect(await h.ctx.repos.wordlists.listByLearner(LOCAL_LEARNER_ID)).toHaveLength(1);
    const historyAfterDuplicate = await h.ctx.repos.importExportHistory.listByLearner(
      LOCAL_LEARNER_ID,
      10,
    );
    expect(historyAfterDuplicate).toHaveLength(2);
    expect(historyAfterDuplicate[0]).toMatchObject({ addedCount: 0, duplicateCount: 3 });
    expect(await h.ctx.repos.operationLog.countByLearner(LOCAL_LEARNER_ID)).toBe(2);
  });

  it('rolls back the entire batch when history persistence fails', async () => {
    h.db.$client.exec(`
      CREATE TRIGGER reject_import_history
      BEFORE INSERT ON import_export_history
      BEGIN
        SELECT RAISE(ABORT, 'forced failure');
      END;
    `);

    await expect(
      executeFileImport(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        fileName: 'rollback.txt',
        fileHash: 'sha256:rollback',
        format: 'txt',
        content: 'alpha\nbeta',
        wordlistName: 'Rollback',
        languageCode: 'en',
      }),
    ).rejects.toThrow('forced failure');

    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID })).toBe(0);
    expect(await h.ctx.repos.wordlists.listByLearner(LOCAL_LEARNER_ID)).toHaveLength(0);
    expect(await h.ctx.repos.operationLog.countByLearner(LOCAL_LEARNER_ID)).toBe(0);
  });

  it('imports and pages 10000 entries under the 30-second performance budget without scheduling them', async () => {
    const content = Array.from({ length: 10_000 }, (_, index) => `word-${index}`).join('\n');
    const startedAt = performance.now();
    const result = await executeFileImport(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      fileName: 'ten-thousand.txt',
      fileHash: 'sha256:ten-thousand',
      format: 'txt',
      content,
      wordlistName: '10000 词性能验收',
      languageCode: 'en',
    });
    const elapsed = performance.now() - startedAt;

    expect(result.addedCount).toBe(10_000);
    expect(elapsed).toBeLessThan(30_000);
    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID, statuses: ['new'] })).toBe(10_000);
    const pageStartedAt = performance.now();
    const page = await listKnowledge(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      statuses: ['new'],
      limit: 50,
      offset: 9_950,
    });
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(10_000);
    expect(performance.now() - pageStartedAt).toBeLessThan(1_000);
    expect(await h.ctx.repos.states.listDueForReview(LOCAL_LEARNER_ID, h.clock.nowIso(), 10)).toHaveLength(0);
  }, 35_000);
});
