import { createDb } from '../src/infrastructure/db/client';

/**
 * Applies pending migrations to the configured database (LLA_DB_PATH).
 * Repeatable: already-applied files are skipped.
 */
const db = createDb({ migrate: false });
const { runMigrations } = await import('../src/infrastructure/db/client');
const applied = runMigrations(db.$client);

if (applied.length === 0) {
  console.log('[migrate] database is up to date');
} else {
  console.log(`[migrate] applied ${applied.length} migration(s):`);
  for (const name of applied) console.log(`  - ${name}`);
}

db.$client.close();
