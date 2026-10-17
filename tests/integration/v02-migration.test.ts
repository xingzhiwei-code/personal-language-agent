import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/infrastructure/db/client';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('M5: v0.1 to v0.2 data migration', () => {
  it('upgrades legacy goal, knowledge and duplicate-hash data without loss and remains idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lla-migration-'));
    dirs.push(dir);
    const client: Client = createClient({ url: pathToFileURL(join(dir, 'migration.db')).href });
    try {
      await applySqlFile(client, resolve(process.cwd(), 'drizzle/0000_init.sql'));
      await applySqlFile(client, resolve(process.cwd(), 'drizzle/0001_nosy_deadpool.sql'));
      await client.execute(`
        CREATE TABLE IF NOT EXISTS _migrations (
          name text PRIMARY KEY,
          applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await client.execute(
        `INSERT INTO _migrations (name) VALUES ('0000_init.sql'), ('0001_nosy_deadpool.sql')`,
      );

      const now = '2026-01-01T00:00:00.000Z';
      const insertGoal = async (id: string, learnerId: string, title: string, rawInput: string) => {
        await client.execute({
          sql: `
            INSERT INTO goals (
              id, learner_id, language_code, title, raw_input, description, scenarios,
              status, priority, is_primary, created_at, updated_at
            ) VALUES (?, ?, 'en', ?, ?, NULL, '[]', 'active', 3, 0, ?, ?)
          `,
          args: [id, learnerId, title, rawInput, now, now],
        });
      };
      await insertGoal('sole-goal', 'sole-learner', '唯一目标', '唯一目标');
      await insertGoal('multi-a', 'multi-learner', '目标 A', '目标 A');
      await insertGoal('multi-b', 'multi-learner', '目标 B', '目标 B');

      const insertKnowledge = async (id: string, type: string) => {
        await client.execute({
          sql: `
            INSERT INTO knowledge_items (
              id, learner_id, language_code, type, text, normalized_text, meaning, notes,
              examples, tags, origin, source_type, source_id, source_ref, ai_generated,
              status, created_at, updated_at
            ) VALUES (?, 'legacy-learner', 'en', ?, 'follow up', 'follow up', NULL, NULL,
              '[]', '[]', 'user', 'user_manual', NULL, NULL, 0, 'active', ?, ?)
          `,
          args: [id, type, now, now],
        });
      };
      await insertKnowledge('legacy-word', 'word');
      await insertKnowledge('legacy-phrase', 'phrase');

      const insertHistory = async (id: string, sourceLabel: string) => {
        await client.execute({
          sql: `
            INSERT INTO import_export_history (
              id, learner_id, type, method, source_label, file_hash, format,
              total_count, added_count, duplicate_count, failed_count, status,
              errors, wordlist_id, goal_id, created_at
            ) VALUES (?, 'legacy-learner', 'import', 'file_upload', ?, 'sha256:same', 'csv',
              1, 1, 0, 0, 'success', '[]', NULL, NULL, ?)
          `,
          args: [id, sourceLabel, now],
        });
      };
      await insertHistory('history-a', 'a.csv');
      await insertHistory('history-b', 'b.csv');

      const row = async (sql: string, ...args: (string | number)[]) => {
        const rs = await client.execute({ sql, args });
        return rs.rows[0];
      };

      const first = await runMigrations(client);
      expect(first).toContain('0002_v02_primary_goal.sql');
      expect(first).toContain('0004_v02_integrity.sql');
      expect(first).toContain('0005_v02_knowledge_dedupe.sql');
      expect(await row('SELECT is_primary, priority FROM goals WHERE id = ?', 'sole-goal')).toEqual(
        { is_primary: 1, priority: 1 },
      );
      expect(
        await row('SELECT SUM(is_primary) AS primary_count FROM goals WHERE learner_id = ?', 'multi-learner'),
      ).toEqual({ primary_count: 1 });
      expect(
        await row('SELECT id FROM goals WHERE learner_id = ? AND is_primary = 1', 'multi-learner'),
      ).toEqual({ id: 'multi-a' });
      expect(
        await row('SELECT COUNT(*) AS count FROM knowledge_items WHERE normalized_text = ?', 'follow up'),
      ).toEqual({ count: 2 });
      await expect(insertKnowledge('legacy-third', 'chunk')).rejects.toThrow(
        'duplicate normalized knowledge',
      );
      expect(
        await row(
          'SELECT COUNT(file_hash) AS count FROM import_export_history WHERE learner_id = ?',
          'legacy-learner',
        ),
      ).toEqual({ count: 1 });
      expect(await runMigrations(client)).toEqual([]);
    } finally {
      client.close();
    }
  });
});

async function applySqlFile(client: Client, path: string): Promise<void> {
  const statements = readFileSync(path, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.batch(statements, 'write');
}
