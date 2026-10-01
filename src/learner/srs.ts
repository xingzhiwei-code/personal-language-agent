import { LEARNER_PARAMS as P, clamp, clamp01, round4 } from './params';

export interface SrsState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  retrievalStrength: number;
}

export interface SrsResult extends SrsState {
  nextReviewAt: string;
}

/** Maps a 0..1 score to an SM-2 style quality value (0..5). */
export function qualityFromScore(score: number): number {
  const value = clamp01(score);
  if (value >= 0.9) return 5;
  if (value >= 0.75) return 4;
  if (value >= P.successThreshold) return 3;
  if (value >= 0.35) return 2;
  if (value > 0) return 1;
  return 0;
}

export function addDays(nowIso: string, days: number): string {
  const base = Date.parse(nowIso);
  const ms = Number.isFinite(base) ? base : Date.now();
  return new Date(ms + days * 86_400_000).toISOString();
}

/**
 * Deterministic SM-2 lite. No LLM involvement (PRD §10.5).
 * A first success yields a 1-day interval — mastery cannot jump to "stable".
 */
export function scheduleNext(prev: SrsState, score: number, nowIso: string): SrsResult {
  const quality = qualityFromScore(score);
  const success = quality >= 3;

  let easeFactor = prev.easeFactor || P.easeDefault;
  let repetitions = Math.max(0, prev.repetitions);
  let intervalDays: number;
  let retrievalStrength: number;

  if (!success) {
    easeFactor = clamp(easeFactor - P.failureEasePenalty, P.easeMin, P.easeMax);
    repetitions = 0;
    intervalDays = P.relearnIntervalDays;
    retrievalStrength = Math.max(
      P.retrievalFailureFloor,
      prev.retrievalStrength * P.retrievalFailureDecay,
    );
  } else {
    easeFactor = clamp(
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
      P.easeMin,
      P.easeMax,
    );
    repetitions += 1;
    if (repetitions === 1) intervalDays = P.firstIntervalDays;
    else if (repetitions === 2) intervalDays = P.secondIntervalDays;
    else intervalDays = Math.min(P.maxIntervalDays, prev.intervalDays * easeFactor);
    retrievalStrength = clamp01(P.retrievalBase + P.retrievalPerRepetition * repetitions);
  }

  return {
    easeFactor: round4(easeFactor),
    intervalDays: round4(intervalDays),
    repetitions,
    retrievalStrength: round4(retrievalStrength),
    nextReviewAt: addDays(nowIso, intervalDays),
  };
}

export function isDue(nextReviewAt: string | null, nowIso: string): boolean {
  if (!nextReviewAt) return true;
  return Date.parse(nextReviewAt) <= Date.parse(nowIso);
}

/** How overdue an item is, in days (0 when not yet due). */
export function overdueDays(nextReviewAt: string | null, nowIso: string): number {
  if (!nextReviewAt) return 0;
  const diff = (Date.parse(nowIso) - Date.parse(nextReviewAt)) / 86_400_000;
  return diff > 0 ? round4(diff) : 0;
}
