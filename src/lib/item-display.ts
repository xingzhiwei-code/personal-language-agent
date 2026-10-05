import type { KnowledgeItem } from '@/domain/entities';

/**
 * Display helpers for study cards (v0.3 §D1/D2). Phonetic is stored inside
 * `notes` as `音标：/x/` by the v0.2 importer; these helpers read it back.
 */

export function phoneticFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/音标：([^·]+)/);
  return match ? (match[1]?.trim() ?? null) : null;
}

export interface SourceSpan {
  text: string;
  source: string | null;
}

/**
 * The "real sentence" shown on a card. Prefer the example sentence (annotated
 * with its source); fall back to the item's recorded source span. Returns null
 * when neither exists, so the UI can omit the block instead of fabricating.
 */
export function sourceSpanOf(item: KnowledgeItem): SourceSpan | null {
  const example = item.examples[0];
  if (example) {
    return { text: example.text, source: example.sourceRef ?? item.sourceRef ?? null };
  }
  if (item.sourceRef) return { text: item.sourceRef, source: null };
  return null;
}
