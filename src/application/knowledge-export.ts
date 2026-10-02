import type { KnowledgeItem } from '@/domain/entities';
import type { KnowledgeStatus } from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { recordKnowledgeOperation } from './audit';
import type { AppContext } from './types';

export type KnowledgeExportFormat = 'json' | 'csv';

export interface KnowledgeExportResult {
  body: string;
  contentType: string;
  filename: string;
  count: number;
}

export async function exportKnowledgeLibrary(
  ctx: AppContext,
  input: {
    learnerId: string;
    format: KnowledgeExportFormat;
    text?: string;
    statuses?: KnowledgeStatus[];
    tags?: string[];
    wordlistIds?: string[];
  },
): Promise<KnowledgeExportResult> {
  if (input.format !== 'json' && input.format !== 'csv') throw validationFailed('不支持的导出格式');
  const query = {
    learnerId: input.learnerId,
    text: input.text,
    statuses: input.statuses,
    tags: input.tags,
    wordlistIds: input.wordlistIds,
  };
  const total = await ctx.repos.knowledge.count(query);
  const items: KnowledgeItem[] = [];
  for (let offset = 0; offset < total; offset += 1000) {
    items.push(...(await ctx.repos.knowledge.search({ ...query, limit: 1000, offset })));
  }
  const states = await ctx.repos.states.listBySubjectType(input.learnerId, 'knowledge_item');
  const masteryByItem = new Map(states.map((state) => [state.subjectId, state.mastery]));
  const rows = items.map((item) => ({ item, mastery: masteryByItem.get(item.id) ?? 0 }));

  const date = ctx.clock.nowIso().slice(0, 10);
  const body =
    input.format === 'json'
      ? JSON.stringify(
          rows.map(({ item, mastery }) => ({
            _exportVersion: 2,
            ...item,
            mastery,
            word: item.text,
            definition: item.meaning,
            example: item.examples[0]?.text ?? null,
          })),
          null,
          2,
        )
      : toCsv(
          rows.map(({ item, mastery }) => ({
            word: item.text,
            definition: item.meaning ?? '',
            example: item.examples[0]?.text ?? '',
            status: item.status,
            mastery,
          })),
        );
  const now = ctx.clock.nowIso();
  const sourceLabel =
    input.text || input.statuses?.length || input.tags?.length || input.wordlistIds?.length
      ? '知识库筛选结果'
      : '全部知识库';
  await ctx.repos.importExportHistory.create({
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    type: 'export',
    method: 'manual',
    sourceLabel,
    fileHash: null,
    format: input.format,
    totalCount: items.length,
    addedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
    status: 'success',
    errors: [],
    wordlistId: null,
    goalId: null,
    createdAt: now,
  });
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'export',
    source: 'manual',
    note: `${input.format.toUpperCase()} · ${items.length} 条 · ${sourceLabel}`,
  });

  return {
    body,
    contentType: input.format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
    filename: `knowledge-${date}.${input.format}`,
    count: items.length,
  };
}

function toCsv(rows: Record<string, string | number>[]): string {
  const headers = ['word', 'definition', 'example', 'status', 'mastery'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header] ?? '')).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function escapeCsv(value: string | number): string {
  const raw = String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
