import { createHash } from 'node:crypto';
import type { WordRelation } from '@/domain/entities';
import type { WordRelationType } from '@/domain/enums';

/**
 * v0.5 §W1 — offline WordNet relation building and anchor filtering.
 *
 * Pure functions only (no DB, no IO): shared by the import script and the
 * unit/integration tests. The runtime (scheduler) never imports this; the
 * relations are materialised once into `word_relations` by the idempotent
 * import script, so the runtime keeps its zero-LLM / zero-WordNet dependency
 * (宪法#4).
 */

/** Canonical lemma form: lowercase, space-separated (underscores/hyphens collapse). */
export function normalizeLemma(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

/** Deterministic id (sha256 of the relation tuple) → re-runs are no-ops. */
export function relationId(
  word: string,
  related: string,
  type: string,
  topic: string | null,
): string {
  return createHash('sha256')
    .update(`${word}\u0000${related}\u0000${type}\u0000${topic ?? ''}`)
    .digest('hex')
    .slice(0, 32);
}

/** A raw WordNet relation edge from the pre-generated full dataset. */
export interface WordnetRelationEdge {
  word: string;
  related: string;
  type: WordRelationType;
}

export interface BuildWordRelationsInput {
  /** Curated IELTS topic vocabulary (`ielts-topics.json`): topic → words. */
  topicWords: Record<string, string[]>;
  /** Full WordNet relation edges (`wordnet-relations-full.json`). */
  wordnetRelations: readonly WordnetRelationEdge[];
  /** Anchor lemmas (CET6/IELTS wordlists + the learner's learned words). */
  anchorLemmas: ReadonlySet<string>;
}

/**
 * Materialises `word_relations` rows from topic vocabulary + WordNet edges.
 *
 * Anchor filtering applies to WordNet rows only: a row is kept iff its source
 * lemma is an anchor word. Topic rows are NOT filtered — `ielts-topics.json` is
 * a small curated list, not a whole-WordNet dump (v0.4 §G3 behaviour).
 */
export function buildWordRelations(input: BuildWordRelationsInput): WordRelation[] {
  const relations: WordRelation[] = [];

  for (const [topic, words] of Object.entries(input.topicWords)) {
    for (const word of words) {
      const lemma = normalizeLemma(word);
      if (lemma.length === 0) continue;
      relations.push({
        id: relationId(lemma, topic, 'topic', topic),
        wordLemma: lemma,
        relatedLemma: topic,
        relationType: 'topic',
        topic,
        source: 'topic_list',
      });
    }
  }

  for (const edge of input.wordnetRelations) {
    const word = normalizeLemma(edge.word);
    if (word.length === 0) continue;
    if (!input.anchorLemmas.has(word)) continue;
    const related = normalizeLemma(edge.related);
    if (related.length === 0) continue;
    relations.push({
      id: relationId(word, related, edge.type, null),
      wordLemma: word,
      relatedLemma: related,
      relationType: edge.type,
      topic: null,
      source: 'wordnet',
    });
  }

  return relations;
}
