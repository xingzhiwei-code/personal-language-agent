import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { schema } from './schema';

/**
 * The drizzle database handle. `@libsql/client`'s raw `$client` handle is NOT
 * exposed on this type on purpose: application code should go through drizzle
 * (or the repository layer) rather than reaching for raw SQL. Scripts and tests
 * that genuinely need the raw handle use {@link getDbClient}.
 */
export type Db = LibSQLDatabase<typeof schema>;

const DEFAULT_DB_PATH = './data/app.db';
const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle');

interface ResolvedConnection {
  url: string;
  authToken?: string;
  /** Filesystem path of a local `file:` database (for mkdir); undefined for remote/in-memory. */
  localPath?: string;
}

/**
 * Resolves the connection target. Priority (highest first):
 *   1. TURSO_DATABASE_URL — remote Turso (TURSO_AUTH_TOKEN for auth);
 *   2. LLA_DB_PATH — local file (converted to a `file:` URL; `:memory:` kept as-is);
 *   3. ./data/app.db — default local file.
 *
 * Turso is the single source of truth for the deployed app; the local file
 * mode exists only as an offline escape hatch (see .env.example).
 */
function resolveConnection(options: CreateDbOptions = {}): ResolvedConnection {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  if (tursoUrl) {
    return {
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    };
  }

  const configured = options.path ?? process.env.LLA_DB_PATH?.trim();
  const target = configured && configured.length > 0 ? configured : DEFAULT_DB_PATH;
  if (target === ':memory:') return { url: ':memory:' };

  const absolute = resolve(process.cwd(), target);
  return { url: pathToFileURL(absolute).href, localPath: absolute };
}

/** Creates a raw {@link Client} for the configured target without running migrations. */
export function createDbClient(options: CreateDbOptions = {}): Client {
  const conn = resolveConnection(options);
  if (conn.localPath) {
    mkdirSync(dirname(conn.localPath), { recursive: true });
  }
  return createClient({
    url: conn.url,
    authToken: conn.authToken,
    // Busy timeout for local `file:` databases (the equivalent of the old
    // `busy_timeout` pragma) so concurrent write transactions wait instead of
    // failing with SQLITE_BUSY. Remote clients ignore this option.
    timeout: 5000,
  });
}

/**
 * Applies every `drizzle/*.sql` migration exactly once, tracked in
 * `_migrations`. Safe to run repeatedly (idempotent) and on a clean database.
 */
export async function runMigrations(client: Client): Promise<string[]> {
  // Local `file:` databases use WAL so that two concurrent write transactions
  // serialize instead of deadlocking (drizzle's libsql driver starts every
  // transaction with BEGIN IMMEDIATE, which deadlocks in the default rollback
  // journal mode). Persistent in the DB file and ignored by remote Turso.
  if (client.protocol === 'file') {
    await client.execute('PRAGMA journal_mode = WAL');
  }

  await client.execute(
    'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );

  if (!existsSync(MIGRATIONS_DIR)) return [];

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedResult = await client.execute('SELECT name FROM _migrations');
  const applied = new Set(appliedResult.rows.map((row) => String(row.name)));

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // drizzle-kit separates statements with `--> statement-breakpoint`.
    const statements = raw
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    // `batch` runs the statements plus the bookkeeping insert atomically, so a
    // partially-applied migration file never gets recorded as applied.
    await client.batch(
      [
        ...statements,
        {
          sql: 'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
          args: [file, new Date().toISOString()],
        },
      ],
      'write',
    );

    newlyApplied.push(file);
  }

  return newlyApplied;
}

export interface CreateDbOptions {
  path?: string;
  migrate?: boolean;
}

/** Raw client handles keyed by drizzle instance, for scripts/tests that need them. */
const clients = new WeakMap<Db, Client>();

/**
 * Serialises async critical sections. `@libsql/client` + drizzle start every
 * transaction with `BEGIN IMMEDIATE`; two concurrent transactions on a local
 * file DB deadlock (one holds the write lock, the other busy-waits while
 * holding a read lock that blocks the first commit). The original synchronous
 * SQLite driver serialised transactions on the event loop, so "concurrent"
 * transactions were already sequential in practice — this mutex restores that
 * behaviour.
 */
class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Wraps a drizzle db so that `transaction` calls are serialised via a mutex. */
function wrapDb(client: Client): Db {
  const rawDb = drizzle(client, { schema });
  const mutex = new AsyncMutex();
  const db = new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        const original = Reflect.get(target, prop, receiver) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        return (...args: unknown[]) => mutex.runExclusive(() => original.apply(target, args));
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;
  clients.set(db, client);
  return db;
}

export async function createDb(options: CreateDbOptions = {}): Promise<Db> {
  const client = createDbClient(options);
  const db = wrapDb(client);

  if (options.migrate !== false) {
    await runMigrations(client);
  }

  return db;
}

/** Returns the raw `@libsql/client` handle for a drizzle instance created via {@link createDb}. */
export function getDbClient(db: Db): Client {
  const client = clients.get(db);
  if (!client) {
    throw new Error('Database client not found; was this db created via createDb()?');
  }
  return client;
}

// Cached across Next.js hot reloads so we do not leak SQLite handles in dev.
// The cached value is a promise so concurrent first-touch requests share one
// initialisation (and one migration run).
const globalForDb = globalThis as unknown as {
  __llaDbPromise?: Promise<Db>;
  __llaClient?: Client;
};

export function getDb(): Promise<Db> {
  if (!globalForDb.__llaDbPromise) {
    globalForDb.__llaDbPromise = (async () => {
      const client = createDbClient();
      const db = wrapDb(client);
      globalForDb.__llaClient = client;
      await runMigrations(client);
      return db;
    })();
  }
  return globalForDb.__llaDbPromise;
}

export function closeDb(): void {
  if (globalForDb.__llaClient) {
    globalForDb.__llaClient.close();
    globalForDb.__llaClient = undefined;
  }
  globalForDb.__llaDbPromise = undefined;
}
