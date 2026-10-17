import { createDbClient, runMigrations } from '../src/infrastructure/db/client';

/**
 * Applies pending migrations to the configured database.
 *
 * Target selection (matches the app's connection resolution):
 *   - TURSO_DATABASE_URL (with TURSO_AUTH_TOKEN) → remote Turso (single source of truth);
 *   - LLA_DB_PATH → local file (offline escape hatch only);
 *   - default → ./data/app.db.
 *
 * Repeatable: already-applied files are skipped.
 */
const client = createDbClient();

try {
  const applied = await runMigrations(client);

  if (applied.length === 0) {
    console.log('[migrate] database is up to date');
  } else {
    console.log(`[migrate] applied ${applied.length} migration(s):`);
    for (const name of applied) console.log(`  - ${name}`);
  }
} finally {
  client.close();
}
