import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOCAL_LEARNER_ID } from '../src/application/types';
import {
  buildWordRelations,
  normalizeLemma,
  type WordnetRelationEdge,
} from '../src/data/wordnet';
import type { WordRelationRepository } from '../src/domain/ports';
import { createDb } from '../src/infrastructure/db/client';
import { createSqliteRepositories } from '../src/infrastructure/repositories/sqlite';

/**
 * v0.4 §G3 → v0.5 §W1 — offline word-relation import.
 *
 * Idempotent: deterministic ids (sha256 of the relation tuple) + upsert make
 * re-runs no-ops, which is also what makes it resumable (断点续跑): a run that
 * is interrupted can simply be re-run and already-inserted rows are skipped.
 * Old subset rows are never deleted — the import only ever inserts, and a
 * consistency check reports coverage after the run (只增不删 + 校验后切换).
 *
 * Anchor filtering: WordNet rows are kept only when their source lemma is in
 * the anchor set (CET6/IELTS wordlists + the learner's learned words). Topic
 * rows come from the curated `ielts-topics.json` and are not anchor-filtered.
 * The runtime never calls WordNet or an LLM (宪法#4).
 */

const here = dirname(fileURLToPath(import.meta.url));

interface TopicFile {
  topics: Record<string, string[]>;
}
interface WordnetFullFile {
  relations: WordnetRelationEdge[];
}

const ANCHOR_CSV_FILES = ['cet6-wordlist.csv', 'ielts-wordlist.csv'] as const;

/** Reads the CET6/IELTS wordlists (column 0 = word) into a normalised lemma set. */
function readAnchorCsvLemmas(): Set<string> {
  const lemmas = new Set<string>();
  for (const file of ANCHOR_CSV_FILES) {
    const text = readFileSync(resolve(here, 'data', file), 'utf8');
    for (const line of text.split(/\r?\n/).slice(1)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const word = trimmed.split(',')[0]!.trim().replace(/^"|"$/g, '');
      const lemma = normalizeLemma(word);
      if (lemma.length > 0) lemmas.add(lemma);
    }
  }
  return lemmas;
}

function readTopicWords(): Record<string, string[]> {
  const file = JSON.parse(
    readFileSync(resolve(here, 'data/ielts-topics.json'), 'utf8'),
  ) as TopicFile;
  return file.topics;
}

function readWordnetEdges(): WordnetRelationEdge[] {
  const file = JSON.parse(
    readFileSync(resolve(here, 'data/wordnet-relations-full.json'), 'utf8'),
  ) as WordnetFullFile;
  return file.relations;
}

export interface ImportResult {
  /** Number of rows built and upserted by this run. */
  imported: number;
  /** Total rows in the table after the run. */
  total: number;
  topicCount: number;
  wordnetCount: number;
  /** Anchor words that gained at least one WordNet relation row. */
  anchorCoverage: { total: number; covered: number };
}

/**
 * Builds (with anchor filtering) and upserts the relation rows. Idempotent and
 * resumable. Exposed separately so tests can exercise the import path against a
 * temp database without going through the CLI entrypoint.
 */
export async function importWordRelations(deps: {
  repository: WordRelationRepository;
  topicWords: Record<string, string[]>;
  wordnetRelations: readonly WordnetRelationEdge[];
  anchorLemmas: ReadonlySet<string>;
}): Promise<ImportResult> {
  const relations = buildWordRelations(deps);

  // Idempotent / resumable: `onConflictDoNothing` on the deterministic id means
  // a re-run (or a continuation after interruption) skips existing rows.
  await deps.repository.upsertMany(relations);

  const total = await deps.repository.count();
  const topicCount = relations.filter((r) => r.relationType === 'topic').length;
  const wordnetCount = relations.length - topicCount;

  // Consistency check: every WordNet source lemma must be an anchor word, and
  // we report how many anchors actually gained at least one relation.
  const covered = new Set(
    relations.filter((r) => r.source === 'wordnet').map((r) => r.wordLemma),
  );
  const anchorCoverage = { total: deps.anchorLemmas.size, covered: covered.size };

  return { imported: relations.length, total, topicCount, wordnetCount, anchorCoverage };
}

async function main(): Promise<void> {
  const db = createDb();
  const repos = createSqliteRepositories(db);

  const anchorLemmas = readAnchorCsvLemmas();
  const learnedItems = await repos.knowledge.search({
    learnerId: LOCAL_LEARNER_ID,
    statuses: ['active', 'user_mastered'],
    limit: 200_000,
  });
  let learnedAdded = 0;
  for (const item of learnedItems) {
    const lemma = normalizeLemma(item.text);
    if (lemma.length > 0 && !anchorLemmas.has(lemma)) {
      anchorLemmas.add(lemma);
      learnedAdded += 1;
    }
  }

  const result = await importWordRelations({
    repository: repos.wordRelations,
    topicWords: readTopicWords(),
    wordnetRelations: readWordnetEdges(),
    anchorLemmas,
  });

  console.log('[import-word-relations] done');
  console.log(`  anchor lemmas: ${anchorLemmas.size} (csv + ${learnedAdded} learned words)`);
  console.log(`  rows upserted this run: ${result.imported}`);
  console.log(`  total in table: ${result.total}`);
  console.log(`  topic rows: ${result.topicCount}, wordnet rows: ${result.wordnetCount}`);
  console.log(
    `  anchor coverage: ${result.anchorCoverage.covered}/${result.anchorCoverage.total} anchors have ≥1 relation`,
  );

  db.$client.close();
}

// Only run the CLI when executed directly (not when imported by tests).
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error('[import-word-relations] failed', error);
    process.exitCode = 1;
  });
}
