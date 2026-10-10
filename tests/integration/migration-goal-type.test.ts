import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goals } from '@/infrastructure/db/schema';
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

  beforeEach(() => {
    h = createTestHarness();
  });

  afterEach(() => h.cleanup());

  function insertLegacyGoal(id: string, title: string, rawInput: string): void {
    h.db
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

  function goalTypes(): Record<string, string> {
    return Object.fromEntries(h.db.select().from(goals).all().map((goal) => [goal.id, goal.goalType]));
  }

  it('reclassifies IELTS-keyword goals and keeps the rest general', () => {
    insertLegacyGoal('g1', '我要准备雅思考试', '');
    insertLegacyGoal('g2', 'Improve my IELTS writing', '');
    insertLegacyGoal('g3', '提高商务英语', '');
    insertLegacyGoal('g4', '日常英语积累', '目标是考雅思口语');

    h.db.$client.exec(backfillSql());

    expect(goalTypes()).toEqual({
      g1: 'ielts',
      g2: 'ielts',
      g3: 'general',
      g4: 'ielts',
    });
  });

  it('is idempotent: running twice yields the same result', () => {
    insertLegacyGoal('g1', '我要准备雅思考试', '');
    insertLegacyGoal('g3', '提高商务英语', '');

    h.db.$client.exec(backfillSql());
    const first = goalTypes();
    h.db.$client.exec(backfillSql());
    expect(goalTypes()).toEqual(first);
    expect(first).toEqual({ g1: 'ielts', g3: 'general' });
  });

  it('leaves goals already typed as ielts untouched', () => {
    h.db
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

    h.db.$client.exec(backfillSql());

    expect(goalTypes()).toEqual({ 'g-ielts': 'ielts' });
  });
});
