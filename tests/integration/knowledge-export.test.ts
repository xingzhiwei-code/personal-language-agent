import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeFileImport } from '@/application/importer';
import { createKnowledgeItem, updateKnowledgeItem } from '@/application/knowledge';
import { exportKnowledgeLibrary } from '@/application/knowledge-export';
import { createTestHarness, LOCAL_LEARNER_ID, type TestHarness } from '../helpers/context';

describe('M5: knowledge library export', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });
  afterEach(() => h.cleanup());

  it('exports JSON with full fields and import-compatible aliases, then round-trips into an empty database', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
      examples: [{ text: 'I figured it out.', origin: 'user' }],
      tags: ['work'],
    });
    const exported = await exportKnowledgeLibrary(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      format: 'json',
    });
    const rows = JSON.parse(exported.body) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: 'figure out',
      word: 'figure out',
      meaning: '弄清楚',
      definition: '弄清楚',
      example: 'I figured it out.',
      status: 'active',
      mastery: 0,
      tags: ['work'],
    });

    const empty = createTestHarness();
    try {
      const imported = await executeFileImport(empty.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        fileName: 'knowledge.json',
        fileHash: 'sha256:round-trip',
        format: 'json',
        content: exported.body,
        wordlistName: '恢复导出',
        languageCode: 'en',
      });
      expect(imported.addedCount).toBe(1);
      const restored = await empty.ctx.repos.knowledge.search({ learnerId: LOCAL_LEARNER_ID, limit: 10 });
      expect(restored[0]).toMatchObject({
        text: 'figure out',
        meaning: '弄清楚',
        status: 'active',
        type: 'phrase',
        tags: ['work'],
        entryMethod: 'export_restore',
      });
      expect(restored[0]?.examples[0]?.text).toBe('I figured it out.');
      expect(
        (await empty.ctx.repos.states.find(LOCAL_LEARNER_ID, 'knowledge_item', restored[0]!.id))?.mastery,
      ).toBe(0);
    } finally {
      empty.cleanup();
    }
  });

  it('exports CSV with specified columns, escaping, status and mastery', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'concise',
      meaning: '简洁的, 简明的',
      examples: [{ text: 'Keep it "short", please.', origin: 'user' }],
    });
    const exported = await exportKnowledgeLibrary(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      format: 'csv',
    });

    expect(exported.body).toContain('word,definition,example,status,mastery');
    expect(exported.body).toContain('"简洁的, 简明的"');
    expect(exported.body).toContain('"Keep it ""short"", please."');
    expect(exported.body).toContain(',active,0');
    expect(exported.contentType).toContain('text/csv');
  });

  it('neutralizes spreadsheet formulas in CSV cells', async () => {
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '=HYPERLINK("https://example.test")',
      meaning: '+malicious',
      examples: [{ text: '@command', origin: 'user' }],
    });
    const exported = await exportKnowledgeLibrary(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      format: 'csv',
    });
    expect(exported.body).toContain("'=HYPERLINK");
    expect(exported.body).toContain("'+malicious");
    expect(exported.body).toContain("'@command");
  });

  it('exports only the current filters and records metadata history/log without content', async () => {
    const active = await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'active-match',
      meaning: 'A',
    });
    await createKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'pool-match',
      meaning: 'B',
      poolMode: true,
    });
    await updateKnowledgeItem(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      id: active.item.id,
      notes: 'tracked',
    });

    const exported = await exportKnowledgeLibrary(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      format: 'json',
      text: 'active',
      statuses: ['active'],
    });
    const rows = JSON.parse(exported.body) as { text: string }[];
    expect(rows.map((row) => row.text)).toEqual(['active-match']);

    const history = await h.ctx.repos.importExportHistory.listByLearner(LOCAL_LEARNER_ID, 10);
    expect(history[0]).toMatchObject({ type: 'export', format: 'json', totalCount: 1 });
    const exportLogs = await h.ctx.repos.operationLog.listByLearner(
      LOCAL_LEARNER_ID,
      10,
      0,
      ['export'],
    );
    expect(exportLogs).toHaveLength(1);
    expect(exportLogs[0]?.knowledgeItemId).toBeNull();
    expect(JSON.stringify(exportLogs[0])).not.toContain('弄清楚');
  });
});
