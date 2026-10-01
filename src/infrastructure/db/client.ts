import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const DEFAULT_DB_PATH = './data/app.db';
const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle');

function resolveDbPath(): string {
  const configured = process.env.LLA_DB_PATH?.trim();
  const target = configured && configured.length > 0 ? configured : DEFAULT_DB_PATH;
  if (target === ':memory:') return target;
  return resolve(process.cwd(), target);
}

/**
 * Applies every `drizzle/*.sql` migration exactly once, tracked in
 * `_migrations`. Safe to run repeatedly (idempotent) and on a clean database.
 */
export function runMigrations(sqlite: Database.Database): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );

  if (!existsSync(MIGRATIONS_DIR)) return [];

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = new Set(
    sqlite
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const newlyApplied: string[] = [];
  const insert = sqlite.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // drizzle-kit separates statements with `--> statement-breakpoint`
    const statements = raw
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    const migrate = sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.exec(statement);
      }
      insert.run(file, new Date().toISOString());
    });
    migrate();
    newlyApplied.push(file);
  }

  return newlyApplied;
}

export interface CreateDbOptions {
  path?: string;
  migrate?: boolean;
}

export function createDb(options: CreateDbOptions = {}): Db {
  const path = options.path ?? resolveDbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  if (options.migrate !== false) {
    runMigrations(sqlite);
  }

  return drizzle(sqlite, { schema }) as Db;
}

// Cached across Next.js hot reloads so we do not leak SQLite handles in dev.
const globalForDb = globalThis as unknown as { __llaDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__llaDb) {
    globalForDb.__llaDb = createDb();
  }
  return globalForDb.__llaDb;
}

export function closeDb(): void {
  if (globalForDb.__llaDb) {
    globalForDb.__llaDb.$client.close();
    globalForDb.__llaDb = undefined;
  }
}
