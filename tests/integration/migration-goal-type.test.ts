import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goals } from '@/infrastructure/db/schema';
import { getDbClient } from '@/infrastructure/db/client';
import { createTestHarness, type TestHarness } from '../helpers/context';

/**
 * Verifies the data-only backfill in drizzle/0009_v04_goal_type_backfill.sql.
 * The migration runner already ran the file against this (empty) database and
 * recorded it, so we insert "legacy" rows directly and execute the SQL by hand
 * to prove its re-classification and idempotence in isolation.
 */
function backfillSql(): string {
  return readFileSync(
    resolve(process.cwd(), 'drizzle/0009_v04_goal_type_backfill.sql'),
    'utf8',
  );
}

describe('v0.4 goal_type backfill migration', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(() => h.cleanup());

  async function insertLegacyGoal(id: string, title: string, rawInput: string): Promise<void> {
    await h.db
      .insert(goals)
      .values({
        id,
        learnerId: 'learner-a',
        languageCode: 'zh',
        title,
        rawInput,
        goalType: 'general',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();
  }

  async function goalTypes(): Promise<Record<string, string>> {
    const rows = await h.db.select().from(goals).all();
    return Object.fromEntries(rows.map((goal) => [goal.id, goal.goalType]));
  }

  it('reclassifies IELTS-keyword goals and keeps the rest general', async () => {
    await insertLegacyGoal('g1', '我要准备雅思考试', '');
    await insertLegacyGoal('g2', 'Improve my IELTS writing', '');
    await insertLegacyGoal('g3', '提高商务英语', '');
    await insertLegacyGoal('g4', '日常英语积累', '目标是考雅思口语');

    await getDbClient(h.db).execute(backfillSql());

    expect(await goalTypes()).toEqual({
      g1: 'ielts',
      g2: 'ielts',
      g3: 'general',
      g4: 'ielts',
    });
  });

  it('is idempotent: running twice yields the same result', async () => {
    await insertLegacyGoal('g1', '我要准备雅思考试', '');
    await insertLegacyGoal('g3', '提高商务英语', '');

    await getDbClient(h.db).execute(backfillSql());
    const first = await goalTypes();
    await getDbClient(h.db).execute(backfillSql());
    expect(await goalTypes()).toEqual(first);
    expect(first).toEqual({ g1: 'ielts', g3: 'general' });
  });

  it('leaves goals already typed as ielts untouched', async () => {
    await h.db
      .insert(goals)
      .values({
        id: 'g-ielts',
        learnerId: 'learner-a',
        languageCode: 'zh',
        title: '雅思',
        rawInput: '',
        goalType: 'ielts',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();

    await getDbClient(h.db).execute(backfillSql());

    expect(await goalTypes()).toEqual({ 'g-ielts': 'ielts' });
  });
});
