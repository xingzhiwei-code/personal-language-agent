import type { Modality } from '@/domain/enums';

/**
 * Deterministic group/ladder helpers for the D2 study loop (v0.3 §D2).
 * Pure functions, no I/O — unit-testable.
 */

/** Recognition → recall → production: the question ladder, never shuffled. */
export const MODALITY_LADDER: readonly Modality[] = ['recognition', 'recall', 'production'];

const LADDER_ORDER = new Map(MODALITY_LADDER.map((modality, index) => [modality, index]));

/** Stable-sorts questions by the recognition → recall → production ladder. */
export function orderByLadder<T extends { modality: Modality }>(specs: readonly T[]): T[] {
  return [...specs].sort((a, b) => {
    const aOrder = LADDER_ORDER.get(a.modality) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = LADDER_ORDER.get(b.modality) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

/** A wrong item may re-appear at most this many extra times within a session. */
export const MAX_REQUEUE_ROUNDS = 2;

/**
 * Wrong-answer requeue gate (v0.3 §D2): an item answered wrong re-appears
 * later in the session, but only while it has appeared fewer than
 * `1 + maxRounds` times total. After that it stops — no infinite loop, no
 * punishment — and is left to the due scheduler.
 *
 * @param appearancesSoFar how many times this subject has already appeared in
 *   the session (including the current, just-answered attempt).
 * @param maxRounds maximum extra rounds (default 2).
 */
export function canRequeue(appearancesSoFar: number, maxRounds = MAX_REQUEUE_ROUNDS): boolean {
  return appearancesSoFar < 1 + maxRounds;
}
