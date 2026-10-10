import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WordRelation } from '../src/domain/entities';
import type { WordRelationType } from '../src/domain/enums';
import { createDb } from '../src/infrastructure/db/client';
import { createWordRelationRepository } from '../src/infrastructure/repositories/sqlite';

/**
 * v0.4 §G3 — offline word-relation import. Idempotent: deterministic ids make
 * re-runs no-ops. Runtime never calls WordNet or an LLM (宪法#4).
 *
 * Data sources (see scripts/data/):
 *   - ielts-topics.json   — curated IELTS topic vocabulary (topic labels).
 *   - wordnet-relations.json — WordNet 3.1 synonym/antonym/word-family subset.
 */

const here = dirname(fileURLToPath(import.meta.url));

interface TopicFile {
  topics: Record<string, string[]>;
}
interface WordnetRelationEntry {
  word: string;
  related: string;
  type: WordRelationType;
}

const topicFile = JSON.parse(
  readFileSync(resolve(here, 'data/ielts-topics.json'), 'utf8'),
) as TopicFile;
const wordnetFile = JSON.parse(
  readFileSync(resolve(here, 'data/wordnet-relations.json'), 'utf8'),
) as { relations: WordnetRelationEntry[] };

function relationId(
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

function buildRelations(): WordRelation[] {
  const relations: WordRelation[] = [];

  for (const [topic, words] of Object.entries(topicFile.topics)) {
    for (const word of words) {
      const lemma = word.trim().toLowerCase();
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

  for (const entry of wordnetFile.relations) {
    const word = entry.word.trim().toLowerCase();
    const related = entry.related.trim().toLowerCase();
    if (word.length === 0 || related.length === 0) continue;
    relations.push({
      id: relationId(word, related, entry.type, null),
      wordLemma: word,
      relatedLemma: related,
      relationType: entry.type,
      topic: null,
      source: 'wordnet',
    });
  }

  return relations;
}

const db = createDb();
const repository = createWordRelationRepository(db);
const relations = buildRelations();
await repository.upsertMany(relations);
const total = await repository.count();
console.log(
  `[import-word-relations] upserted ${relations.length} relations (total in table: ${total})`,
);
db.$client.close();
