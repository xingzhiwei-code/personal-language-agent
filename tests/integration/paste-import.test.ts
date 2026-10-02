import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  confirmPastedCandidates,
  extractFromPastedText,
  type ExtractedPasteCandidate,
} from '@/application/paste-import';
import { createScenario } from '@/application/scenarios';
import { createTestHarness, LOCAL_LEARNER_ID, type TestHarness } from '../helpers/context';

const TEXT = 'I need to figure out the schedule before the client meeting. We should follow up tomorrow.';
const CANDIDATES: ExtractedPasteCandidate[] = [
  {
    content: 'figure out',
    type: 'phrase',
    explanation_zh: '弄清楚',
    example: 'I need to figure out the schedule.',
    source_span: 'figure out the schedule',
    scenario_hint: '客户会议',
  },
  {
    content: 'follow up',
    type: 'phrase',
    explanation_zh: '跟进',
    example: 'We should follow up tomorrow.',
    source_span: 'follow up tomorrow',
    scenario_hint: null,
  },
];

describe('M4: pasted text extraction and confirmation', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    h.llm.reply = JSON.stringify(CANDIDATES);
  });
  afterEach(() => h.cleanup());

  it('saves raw content, validates structured output, and writes nothing before confirmation', async () => {
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      title: 'Client meeting',
      text: TEXT,
      languageCode: 'en',
    });

    expect(preview.aiAvailable).toBe(true);
    expect(preview.candidates).toEqual(CANDIDATES);
    expect(h.llm.calls).toBe(1);
    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID })).toBe(0);
    const source = await h.ctx.repos.content.findSourceById(preview.sourceId);
    expect(source).toMatchObject({ title: 'Client meeting', extractionMethod: 'paste', aiGenerated: false });
    const contents = await h.ctx.repos.content.listContentBySource(preview.sourceId);
    expect(contents[0]?.text).toBe(TEXT);
    expect(h.telemetry.list()[0]).toMatchObject({ kind: 'ai.paste_extract', ok: true });
  });

  it('only imports user-confirmed candidates into pool with AI provenance and a user-declared scenario', async () => {
    const scenario = await createScenario(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      name: '客户会议',
      type: 'big',
    });
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      title: 'Client meeting',
      text: TEXT,
      languageCode: 'en',
    });
    const result = await confirmPastedCandidates(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sourceId: preview.sourceId,
      historyId: preview.historyId,
      candidates: [CANDIDATES[0]!],
      directLearning: false,
      languageCode: 'en',
    });

    expect(result).toMatchObject({ totalCount: 1, addedCount: 1, duplicateCount: 0, failedCount: 0 });
    const items = await h.ctx.repos.knowledge.search({ learnerId: LOCAL_LEARNER_ID, limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      text: 'figure out',
      status: 'new',
      aiGenerated: true,
      sourceId: preview.sourceId,
      sourceType: 'user_import',
      entryMethod: 'paste',
      tags: ['客户会议'],
    });
    expect(items[0]?.sourceRef).toContain('figure out the schedule');
    expect((await h.ctx.repos.scenarios.findById(scenario.id))?.knowledgeItemIds).toEqual([
      items[0]?.id,
    ]);
    expect(await h.ctx.repos.states.listDueForReview(LOCAL_LEARNER_ID, h.clock.nowIso(), 10)).toHaveLength(0);
    const history = await h.ctx.repos.importExportHistory.findById(preview.historyId);
    expect(history).toMatchObject({ method: 'paste', totalCount: 1, addedCount: 1, status: 'success' });
  });

  it('extracts 10 candidates from about 2000 characters and imports only 8 selected by the user', async () => {
    const phrases = Array.from({ length: 10 }, (_, index) => `useful-expression-${index}`);
    const longText = `${phrases.join('. ')}. ${'context '.repeat(220)}`.slice(0, 2200);
    const candidates: ExtractedPasteCandidate[] = phrases.map((phrase, index) => ({
      content: phrase,
      type: 'phrase',
      explanation_zh: `实用表达 ${index}`,
      example: `Example with ${phrase}.`,
      source_span: phrase,
      scenario_hint: null,
    }));
    h.llm.reply = JSON.stringify(candidates);
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      title: '2000 字演讲稿',
      text: longText,
      languageCode: 'en',
    });
    expect(preview.candidates).toHaveLength(10);

    const result = await confirmPastedCandidates(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sourceId: preview.sourceId,
      historyId: preview.historyId,
      candidates: preview.candidates.slice(0, 8),
      directLearning: false,
      languageCode: 'en',
    });
    expect(result).toMatchObject({ totalCount: 8, addedCount: 8, duplicateCount: 0, failedCount: 0 });
    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID })).toBe(8);
  });

  it('can explicitly send confirmed expressions directly into learning', async () => {
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: TEXT,
      languageCode: 'en',
    });
    await confirmPastedCandidates(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sourceId: preview.sourceId,
      historyId: preview.historyId,
      candidates: [CANDIDATES[1]!],
      directLearning: true,
      languageCode: 'en',
    });

    const items = await h.ctx.repos.knowledge.search({ learnerId: LOCAL_LEARNER_ID, limit: 10 });
    expect(items[0]?.status).toBe('active');
    expect(await h.ctx.repos.states.listDueForReview(LOCAL_LEARNER_ID, h.clock.nowIso(), 10)).toHaveLength(1);
  });

  it('without an AI key saves the content source and degrades without throwing', async () => {
    h.llm.configured = false;
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      title: 'Offline text',
      text: TEXT,
      languageCode: 'en',
    });

    expect(preview.aiAvailable).toBe(false);
    expect(preview.candidates).toEqual([]);
    expect(preview.notice).toContain('原文已保存');
    expect(h.llm.calls).toBe(0);
    expect(await h.ctx.repos.content.findSourceById(preview.sourceId)).not.toBeNull();
    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID })).toBe(0);
    const history = await h.ctx.repos.importExportHistory.findById(preview.historyId);
    expect(history?.status).toBe('partial');
  });

  it('malformed or unverifiable AI output degrades and never creates knowledge', async () => {
    h.llm.reply = JSON.stringify([{ ...CANDIDATES[0], source_span: 'not in source' }]);
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: TEXT,
      languageCode: 'en',
    });

    expect(preview.aiAvailable).toBe(false);
    expect(preview.notice).toContain('原文已保存');
    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID })).toBe(0);
    expect(h.telemetry.list()[0]).toMatchObject({ kind: 'ai.paste_extract', ok: false });
  });

  it('rejects over-limit text before persisting anything', async () => {
    await expect(
      extractFromPastedText(h.ctx, {
        learnerId: LOCAL_LEARNER_ID,
        text: 'a'.repeat(8001),
        languageCode: 'en',
      }),
    ).rejects.toThrow('文本不能超过 8000 字符');
    expect(await h.ctx.repos.content.listSourcesByLearner(LOCAL_LEARNER_ID, 10)).toHaveLength(0);
  });

  it('rejects a tampered source span during confirmation and records the failure', async () => {
    const preview = await extractFromPastedText(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: TEXT,
      languageCode: 'en',
    });
    const result = await confirmPastedCandidates(h.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sourceId: preview.sourceId,
      historyId: preview.historyId,
      candidates: [{ ...CANDIDATES[0]!, source_span: 'fabricated source' }],
      directLearning: false,
      languageCode: 'en',
    });

    expect(result).toMatchObject({ addedCount: 0, failedCount: 1 });
    expect(await h.ctx.repos.knowledge.count({ learnerId: LOCAL_LEARNER_ID })).toBe(0);
  });
});
