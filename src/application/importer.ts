import type {
  ImportExportHistory,
  KnowledgeItem,
  KnowledgeOperationLog,
  LearnerState,
  Wordlist,
} from '@/domain/entities';
import { knowledgeItemSchema } from '@/domain/entities';
import { languageCodeSchema, type KnowledgeType } from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { classifyKnowledgeText, normalizeKnowledgeText } from '@/language/registry';
import { createInitialState } from '@/learner/state';
import type { AppContext } from './types';

export const MAX_IMPORT_ROWS = 20_000;
export const IMPORT_PREVIEW_ROWS = 20;
export type WordlistFormat = 'csv' | 'json' | 'txt';

export interface ParsedWordlistEntry {
  row: number;
  word: string;
  phonetic: string | null;
  pos: string | null;
  definition: string | null;
  example: string | null;
  restore: { item: KnowledgeItem; mastery: number } | null;
}

export interface ImportIssue {
  row: number;
  reason: string;
}

export interface ParsedWordlist {
  entries: ParsedWordlistEntry[];
  errors: ImportIssue[];
  totalCount: number;
}

export interface FileImportPreview {
  fileName: string;
  fileHash: string;
  format: WordlistFormat;
  languageCode: string;
  totalCount: number;
  validCount: number;
  estimatedAddedCount: number;
  duplicateCount: number;
  failedCount: number;
  duplicateFile: boolean;
  largeImport: boolean;
  entries: ParsedWordlistEntry[];
  errors: ImportIssue[];
}

export interface ExecuteFileImportInput {
  learnerId: string;
  fileName: string;
  fileHash: string;
  format: WordlistFormat;
  content: string;
  wordlistName: string;
  languageCode: string;
  goalId?: string | null;
}

export interface FileImportResult {
  duplicateFile: boolean;
  historyId: string;
  wordlistId: string | null;
  totalCount: number;
  addedCount: number;
  duplicateCount: number;
  failedCount: number;
  errors: ImportIssue[];
}

interface Candidate {
  word?: unknown;
  phonetic?: unknown;
  pos?: unknown;
  definition?: unknown;
  example?: unknown;
  _exportVersion?: unknown;
  mastery?: unknown;
  [key: string]: unknown;
}

export function formatFromFileName(fileName: string): WordlistFormat {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'csv' || extension === 'json' || extension === 'txt') return extension;
  throw validationFailed('仅支持 CSV、JSON 或 TXT 文件');
}

export function parseWordlist(content: string, format: WordlistFormat): ParsedWordlist {
  if (content.trim().length === 0) throw validationFailed('文件内容为空');
  if (format === 'csv') return parseCsvWordlist(content);
  if (format === 'json') return parseJsonWordlist(content);
  return parseTxtWordlist(content);
}

function parseCsvWordlist(content: string): ParsedWordlist {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ''));
  if (records.length === 0) throw validationFailed('CSV 文件没有表头');
  const headers = records[0]!.map((value) => value.trim().toLowerCase());
  const wordIndex = headers.indexOf('word');
  if (wordIndex < 0) throw validationFailed('CSV 缺少必需的 word 列');
  const indexOf = (name: string) => headers.indexOf(name);
  const candidates = records.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0));
  assertRowLimit(candidates.length);
  return parseCandidates(
    candidates.map((row) => ({
      word: row[wordIndex],
      phonetic: valueAt(row, indexOf('phonetic')),
      pos: valueAt(row, indexOf('pos')),
      definition: valueAt(row, indexOf('definition')),
      example: valueAt(row, indexOf('example')),
    })),
    2,
  );
}

function parseJsonWordlist(content: string): ParsedWordlist {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw validationFailed('JSON 格式无效，请检查逗号、引号和括号');
  }
  if (!Array.isArray(value)) throw validationFailed('JSON 顶层必须是对象数组');
  assertRowLimit(value.length);
  const candidates = value.map((entry) =>
    typeof entry === 'object' && entry !== null ? (entry as Candidate) : {},
  );
  return parseCandidates(candidates, 1);
}

function parseTxtWordlist(content: string): ParsedWordlist {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const candidates = lines
    .map((word, index) => ({ word, row: index + 1 }))
    .filter((entry) => entry.word.trim().length > 0);
  assertRowLimit(candidates.length);
  return parseCandidates(
    candidates.map((entry) => ({ word: entry.word })),
    1,
    candidates.map((entry) => entry.row),
  );
}

function parseCandidates(candidates: Candidate[], rowOffset: number, sourceRows?: number[]): ParsedWordlist {
  const entries: ParsedWordlistEntry[] = [];
  const errors: ImportIssue[] = [];
  candidates.forEach((candidate, index) => {
    const row = sourceRows?.[index] ?? index + rowOffset;
    try {
      const word = requiredText(candidate.word, 400, 'word');
      const restore = parseRestoreCandidate(candidate);
      entries.push({
        row,
        word,
        phonetic: optionalText(candidate.phonetic, 120, 'phonetic'),
        pos: optionalText(candidate.pos, 80, 'pos'),
        definition: optionalText(candidate.definition, 2000, 'definition'),
        example: optionalText(candidate.example, 600, 'example'),
        restore,
      });
    } catch (error) {
      errors.push({ row, reason: error instanceof Error ? error.message : '字段无效' });
    }
  });
  return { entries, errors: errors.slice(0, 50), totalCount: candidates.length };
}

function parseRestoreCandidate(
  candidate: Candidate,
): { item: KnowledgeItem; mastery: number } | null {
  if (candidate._exportVersion !== 2) return null;
  const parsed = knowledgeItemSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('导出记录字段无效');
  const mastery = typeof candidate.mastery === 'number' ? candidate.mastery : 0;
  if (!Number.isFinite(mastery) || mastery < 0 || mastery > 1) {
    throw new Error('mastery 必须在 0–1 之间');
  }
  return { item: parsed.data, mastery };
}

function requiredText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} 不能为空`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${field} 超过 ${maxLength} 字符`);
  return text;
}

function optionalText(value: unknown, maxLength: number, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本`);
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > maxLength) throw new Error(`${field} 超过 ${maxLength} 字符`);
  return text;
}

function valueAt(row: string[], index: number): string | undefined {
  return index < 0 ? undefined : row[index];
}

function assertRowLimit(count: number): void {
  if (count > MAX_IMPORT_ROWS) {
    throw validationFailed(`单次最多导入 ${MAX_IMPORT_ROWS} 条，请拆分文件后重试`);
  }
}

function validateLanguageCode(languageCode: string): void {
  if (!languageCodeSchema.safeParse(languageCode).success) {
    throw validationFailed('语言代码无效');
  }
}

function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw validationFailed('CSV 存在未闭合的引号');
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ''));
    records.push(record);
  }
  return records;
}

function typeForEntry(languageCode: string, entry: ParsedWordlistEntry): KnowledgeType {
  if (entry.restore) return entry.restore.item.type;
  if (/\b(phr|phrase|phrasal)\b/i.test(entry.pos ?? '')) return 'phrase';
  return classifyKnowledgeText(languageCode, entry.word);
}

function distinctEntries(
  languageCode: string,
  entries: ParsedWordlistEntry[],
): { entries: ParsedWordlistEntry[]; duplicateCount: number } {
  const seen = new Set<string>();
  const distinct: ParsedWordlistEntry[] = [];
  for (const entry of entries) {
    const normalized = normalizeKnowledgeText(languageCode, entry.word);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    distinct.push(entry);
  }
  return { entries: distinct, duplicateCount: entries.length - distinct.length };
}

export async function previewFileImport(
  ctx: AppContext,
  input: {
    learnerId: string;
    fileName: string;
    fileHash: string;
    format: WordlistFormat;
    content: string;
    languageCode: string;
  },
): Promise<FileImportPreview> {
  validateLanguageCode(input.languageCode);
  const parsed = parseWordlist(input.content, input.format);
  const duplicateHistory = await ctx.repos.importExportHistory.findByFileHash(
    input.learnerId,
    input.fileHash,
  );
  const distinct = distinctEntries(input.languageCode, parsed.entries);
  const existing = new Set(
    await ctx.repos.knowledge.listNormalizedByLanguage(input.learnerId, input.languageCode),
  );
  const existingCount = distinct.entries.filter((entry) =>
    existing.has(normalizeKnowledgeText(input.languageCode, entry.word)),
  ).length;
  const duplicateCount = duplicateHistory
    ? parsed.entries.length
    : distinct.duplicateCount + existingCount;

  return {
    fileName: input.fileName,
    fileHash: input.fileHash,
    format: input.format,
    languageCode: input.languageCode,
    totalCount: parsed.totalCount,
    validCount: parsed.entries.length,
    estimatedAddedCount: duplicateHistory ? 0 : distinct.entries.length - existingCount,
    duplicateCount,
    failedCount: parsed.totalCount - parsed.entries.length,
    duplicateFile: duplicateHistory !== null,
    largeImport: parsed.totalCount > 1000,
    entries: parsed.entries.slice(0, IMPORT_PREVIEW_ROWS),
    errors: parsed.errors,
  };
}

export async function executeFileImport(
  ctx: AppContext,
  input: ExecuteFileImportInput,
): Promise<FileImportResult> {
  validateLanguageCode(input.languageCode);
  const wordlistName = input.wordlistName.trim();
  if (wordlistName.length === 0) throw validationFailed('请输入词库名称');
  if (wordlistName.length > 120) throw validationFailed('词库名称不能超过 120 字符');
  if (input.goalId) {
    const goal = await ctx.repos.goals.findById(input.goalId);
    if (!goal || goal.learnerId !== input.learnerId) throw validationFailed('绑定的目标不存在');
  }

  const parsed = parseWordlist(input.content, input.format);
  const distinct = distinctEntries(input.languageCode, parsed.entries);
  const now = ctx.clock.nowIso();
  const wordlistId = ctx.ids.next();
  const sourceLabel = input.fileName.slice(0, 300);
  const wordlist: Wordlist = {
    id: wordlistId,
    learnerId: input.learnerId,
    name: wordlistName,
    languageCode: input.languageCode,
    goalId: input.goalId ?? null,
    tags: [],
    sourceFile: sourceLabel,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const items: KnowledgeItem[] = distinct.entries.map((entry, index) => {
    const notes = [entry.phonetic ? `音标：${entry.phonetic}` : null, entry.pos ? `词性：${entry.pos}` : null]
      .filter((value): value is string => value !== null)
      .join(' · ');
    const restored = entry.restore?.item;
    return {
      id: ctx.ids.next(),
      learnerId: input.learnerId,
      languageCode: restored?.languageCode ?? input.languageCode,
      type: typeForEntry(input.languageCode, entry),
      text: entry.word,
      normalizedText: normalizeKnowledgeText(restored?.languageCode ?? input.languageCode, entry.word),
      meaning: restored?.meaning ?? entry.definition,
      notes: restored?.notes ?? (notes || null),
      examples:
        restored?.examples ??
        (entry.example ? [{ text: entry.example, origin: 'user', sourceRef: sourceLabel }] : []),
      tags: restored?.tags ?? [],
      origin: restored?.origin ?? 'user',
      sourceType: restored?.sourceType ?? 'user_import',
      sourceId: null,
      sourceRef: restored?.sourceRef ?? sourceLabel,
      aiGenerated: restored?.aiGenerated ?? false,
      status: restored?.status ?? 'new',
      wordlistId,
      entryMethod: restored ? 'export_restore' : 'file_upload',
      frequencyRank:
        restored?.frequencyRank ??
        (distinct.entries.length <= 1 ? 0 : index / (distinct.entries.length - 1)),
      createdAt: restored?.createdAt ?? now,
      updatedAt: now,
    };
  });

  const states: LearnerState[] = items.flatMap((item, index) => {
    const restore = distinct.entries[index]?.restore;
    if (!restore || item.status === 'new') return [];
    const initial = createInitialState({
      id: ctx.ids.next(),
      learnerId: input.learnerId,
      subjectType: 'knowledge_item',
      subjectId: item.id,
      nowIso: now,
    });
    return [{
      ...initial,
      mastery: restore.mastery,
      confidence: restore.mastery > 0 ? 0.3 : 0,
      userDeclaredMastered: item.status === 'user_mastered',
      nextReviewAt: item.status === 'active' ? now : null,
      updatedAt: now,
    }];
  });

  const history: ImportExportHistory = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    type: 'import',
    method: 'file_upload',
    sourceLabel,
    fileHash: input.fileHash,
    format: input.format,
    totalCount: parsed.totalCount,
    addedCount: 0,
    duplicateCount: distinct.duplicateCount,
    failedCount: parsed.totalCount - parsed.entries.length,
    status: parsed.errors.length > 0 ? 'partial' : 'success',
    errors: parsed.errors,
    wordlistId,
    goalId: input.goalId ?? null,
    createdAt: now,
  };
  const logs: KnowledgeOperationLog[] = items.map((item) => ({
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    operation: 'import',
    knowledgeItemId: item.id,
    itemText: item.text,
    changes: { status: [null, item.status], wordlistId: [null, wordlistId] },
    source: item.entryMethod,
    note: `从 ${sourceLabel} 导入`,
    createdAt: now,
  }));

  const committed = await ctx.repos.fileImports.commit({ wordlist, history, items, states, logs });
  return {
    duplicateFile: committed.duplicateFile,
    historyId: committed.history.id,
    wordlistId: committed.wordlist?.id ?? committed.history.wordlistId,
    totalCount: parsed.totalCount,
    addedCount: committed.duplicateFile ? 0 : committed.history.addedCount,
    duplicateCount: committed.duplicateFile ? parsed.entries.length : committed.history.duplicateCount,
    failedCount: committed.duplicateFile ? 0 : committed.history.failedCount,
    errors: committed.duplicateFile ? [] : committed.history.errors,
  };
}
