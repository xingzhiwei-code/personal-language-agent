import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/infrastructure/db/client';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('M5: v0.1 to v0.2 data migration', () => {
  it('upgrades legacy goal, knowledge and duplicate-hash data without loss and remains idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lla-migration-'));
    dirs.push(dir);
    const sqlite = new Database(join(dir, 'migration.db'));
    try {
      applySqlFile(sqlite, resolve(process.cwd(), 'drizzle/0000_init.sql'));
      applySqlFile(sqlite, resolve(process.cwd(), 'drizzle/0001_nosy_deadpool.sql'));
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          name text PRIMARY KEY,
          applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO _migrations (name) VALUES ('0000_init.sql'), ('0001_nosy_deadpool.sql');
      `);
      const insertGoal = sqlite.prepare(`
        INSERT INTO goals (
          id, learner_id, language_code, title, raw_input, description, scenarios,
          status, priority, is_primary, created_at, updated_at
        ) VALUES (?, ?, 'en', ?, ?, NULL, '[]', 'active', 3, 0, ?, ?)
      `);
      const now = '2026-01-01T00:00:00.000Z';
      insertGoal.run('sole-goal', 'sole-learner', '唯一目标', '唯一目标', now, now);
      insertGoal.run('multi-a', 'multi-learner', '目标 A', '目标 A', now, now);
      insertGoal.run('multi-b', 'multi-learner', '目标 B', '目标 B', now, now);

      const insertKnowledge = sqlite.prepare(`
        INSERT INTO knowledge_items (
          id, learner_id, language_code, type, text, normalized_text, meaning, notes,
          examples, tags, origin, source_type, source_id, source_ref, ai_generated,
          status, created_at, updated_at
        ) VALUES (?, 'legacy-learner', 'en', ?, 'follow up', 'follow up', NULL, NULL,
          '[]', '[]', 'user', 'user_manual', NULL, NULL, 0, 'active', ?, ?)
      `);
      insertKnowledge.run('legacy-word', 'word', now, now);
      insertKnowledge.run('legacy-phrase', 'phrase', now, now);

      const insertHistory = sqlite.prepare(`
        INSERT INTO import_export_history (
          id, learner_id, type, method, source_label, file_hash, format,
          total_count, added_count, duplicate_count, failed_count, status,
          errors, wordlist_id, goal_id, created_at
        ) VALUES (?, 'legacy-learner', 'import', 'file_upload', ?, 'sha256:same', 'csv',
          1, 1, 0, 0, 'success', '[]', NULL, NULL, ?)
      `);
      insertHistory.run('history-a', 'a.csv', now);
      insertHistory.run('history-b', 'b.csv', now);

      const first = runMigrations(sqlite);
      expect(first).toContain('0002_v02_primary_goal.sql');
      expect(first).toContain('0004_v02_integrity.sql');
      expect(first).toContain('0005_v02_knowledge_dedupe.sql');
      expect(
        sqlite.prepare('SELECT is_primary, priority FROM goals WHERE id = ?').get('sole-goal'),
      ).toEqual({ is_primary: 1, priority: 1 });
      expect(
        sqlite.prepare('SELECT SUM(is_primary) AS primary_count FROM goals WHERE learner_id = ?').get('multi-learner'),
      ).toEqual({ primary_count: 1 });
      expect(
        sqlite.prepare('SELECT id FROM goals WHERE learner_id = ? AND is_primary = 1').get('multi-learner'),
      ).toEqual({ id: 'multi-a' });
      expect(
        sqlite.prepare('SELECT COUNT(*) AS count FROM knowledge_items WHERE normalized_text = ?').get('follow up'),
      ).toEqual({ count: 2 });
      expect(() => insertKnowledge.run('legacy-third', 'chunk', now, now)).toThrow(
        'duplicate normalized knowledge',
      );
      expect(
        sqlite.prepare('SELECT COUNT(file_hash) AS count FROM import_export_history WHERE learner_id = ?').get('legacy-learner'),
      ).toEqual({ count: 1 });
      expect(runMigrations(sqlite)).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});

function applySqlFile(sqlite: Database.Database, path: string): void {
  const statements = readFileSync(path, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  sqlite.transaction(() => {
    for (const statement of statements) sqlite.exec(statement);
  })();
}
