import { createClient } from '@libsql/client';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMigrations } from '../src/infrastructure/db/client';

/**
 * One-off migration helper: copy every row from the local SQLite file
 * (LLA_DB_PATH, default ./data/app.db) into remote Turso.
 *
 * Usage (Turso is the single source of truth — this copies *into* it):
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *   npx tsx scripts/copy-local-to-turso.ts
 *
 * It first runs migrations against Turso (creating tables + `_migrations`),
 * then copies each table's rows and prints a per-table local-vs-Turso row
 * count so you can verify nothing was lost.
 */

const TABLES = [
  'users',
  'goals',
  'learning_targets',
  'goal_phases',
  'placements',
  'scenarios',
  'wordlists',
  'knowledge_items',
  'knowledge_relations',
  'learner_states',
  'learning_events',
  'assessments',
  'learning_sessions',
  'learning_activities',
  'chat_messages',
  'memories',
  'learning_preferences',
  'user_contexts',
  'recommendations',
  'transfer_evidences',
  'content_sources',
  'contents',
  'import_export_history',
  'knowledge_operation_log',
  'word_relations',
] as const;

async function main(): Promise<void> {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!tursoUrl) throw new Error('TURSO_DATABASE_URL is required');
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN is required');

  const localPath = process.env.LLA_DB_PATH?.trim() || './data/app.db';
  const local = createClient({
    url: pathToFileURL(resolve(process.cwd(), localPath)).href,
  });
  const turso = createClient({ url: tursoUrl, authToken });

  try {
    console.log('[copy] applying migrations to Turso …');
    await runMigrations(turso);

    for (const table of TABLES) {
      const source = await local.execute(`SELECT * FROM ${table}`);
      const cols = source.columns;
      const colList = cols.join(', ');
      const placeholders = cols.map(() => '?').join(', ');

      const rows = source.rows;
      for (let offset = 0; offset < rows.length; offset += 500) {
        const chunk = rows.slice(offset, offset + 500);
        await turso.batch(
          chunk.map((row) => ({
            sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
            args: cols.map((col) => row[col] ?? null),
          })),
          'write',
        );
      }

      const target = await turso.execute(`SELECT COUNT(*) AS c FROM ${table}`);
      const targetCount = target.rows[0]?.c;
      console.log(
        `[copy] ${table}: local ${rows.length} → turso ${String(targetCount)} ${
          rows.length === targetCount ? '✓' : '✗ MISMATCH'
        }`,
      );
    }

    console.log('[copy] done');
  } finally {
    local.close();
    turso.close();
  }
}

main().catch((error) => {
  console.error('[copy] failed', error);
  process.exitCode = 1;
});
