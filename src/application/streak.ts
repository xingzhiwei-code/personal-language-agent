import { localDayKey } from './local-day';
import type { AppContext } from './types';

/**
 * Study streak (v0.3 §D3): the number of consecutive natural days with at least
 * one completed session. "Completed" means the learner reached the settlement
 * page — a mid-way exit does not count. Pure function, no storage.
 */

/** Previous day key in UTC, avoiding local-timezone/DST edge cases. */
export function previousDayKey(key: string): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * @param completedDayKeys local day keys (YYYY-MM-DD) that have a completed session.
 * @param todayKey the current local day key.
 * @returns consecutive days ending today; 0 when today has no completed session.
 */
export function computeStreak(completedDayKeys: readonly string[], todayKey: string): number {
  const days = new Set(completedDayKeys);
  if (!days.has(todayKey)) return 0;
  let streak = 1;
  let cursor = previousDayKey(todayKey);
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }
  return streak;
}

/** The learner's current streak, computed from completed sessions. */
export async function getCurrentStreak(ctx: AppContext, learnerId: string): Promise<number> {
  const completed = await ctx.repos.sessions.listByLearner(learnerId, 2000, ['completed']);
  const dayKeys = completed
    // Placement is measurement, not learning — it never counts (v0.4 §G1).
    .filter((session) => session.activityType !== 'placement')
    .map((session) => session.endedAt ?? session.updatedAt)
    .map(localDayKey);
  return computeStreak(dayKeys, localDayKey(ctx.clock.nowIso()));
}
