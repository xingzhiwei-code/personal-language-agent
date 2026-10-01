import type { Evidence, LearnerState } from '@/domain/entities';
import {
  LEARNER_PARAMS as P,
  MASTERY_WEIGHTS as W,
  clamp01,
  daysBetween,
  round4,
} from './params';

export interface MasteryBreakdown {
  recentScore: number;
  historicalScore: number;
  stabilityScore: number;
  retrievalScore: number;
  exposureScore: number;
  mastery: number;
}

export interface MasteryInput {
  recentEvidence: readonly Evidence[];
  successfulAttempts: number;
  failedAttempts: number;
  stabilityDays: number;
  retrievalStrength: number;
  exposureCount: number;
  lastPracticedAt: string | null;
}

/**
 * Recency- and position-weighted average of the most recent evidence,
 * shrunk toward a low prior so one lucky answer cannot spike mastery.
 */
export function computeRecentScore(
  recentEvidence: readonly Evidence[],
  nowIso: string,
): number {
  const window = [...recentEvidence]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, P.recentWindow);

  let weighted = 0;
  let weightSum = 0;
  window.forEach((evidence, index) => {
    const ageDays = daysBetween(evidence.occurredAt, nowIso);
    const recency = Math.pow(0.5, ageDays / P.recentHalfLifeDays);
    const positional = Math.pow(P.recentPositionDecay, index);
    const weight = recency * positional;
    weighted += clamp01(evidence.score) * weight;
    weightSum += weight;
  });

  return clamp01(
    (weighted + P.recentPriorWeight * P.priorMean) / (weightSum + P.recentPriorWeight),
  );
}

/** Lifetime success ratio, shrunk toward the prior mean. */
export function computeHistoricalScore(
  successfulAttempts: number,
  failedAttempts: number,
): number {
  const attempts = Math.max(0, successfulAttempts) + Math.max(0, failedAttempts);
  return clamp01(
    (Math.max(0, successfulAttempts) + P.historicalPriorWeight * P.priorMean) /
      (attempts + P.historicalPriorWeight),
  );
}

export function computeStabilityScore(stabilityDays: number): number {
  if (stabilityDays <= 0) return 0;
  return clamp01(1 - Math.exp(-stabilityDays / P.stabilityScaleDays));
}

/**
 * Current retrievability: the strength right after the last practice, decayed
 * by the time elapsed relative to the current retention interval.
 */
export function computeRetrievalScore(
  retrievalStrength: number,
  stabilityDays: number,
  lastPracticedAt: string | null,
  nowIso: string,
): number {
  if (!lastPracticedAt || retrievalStrength <= 0) return 0;
  const elapsed = daysBetween(lastPracticedAt, nowIso);
  const horizon = Math.max(stabilityDays, 0.5);
  return clamp01(retrievalStrength * Math.exp(-elapsed / horizon));
}

/** Exposure alone is never mastery — it saturates and carries only 10% weight. */
export function computeExposureScore(exposureCount: number): number {
  if (exposureCount <= 0) return 0;
  return clamp01(1 - Math.exp(-exposureCount / P.exposureScale));
}

export function computeMastery(input: MasteryInput, nowIso: string): MasteryBreakdown {
  const recentScore = computeRecentScore(input.recentEvidence, nowIso);
  const historicalScore = computeHistoricalScore(
    input.successfulAttempts,
    input.failedAttempts,
  );
  const stabilityScore = computeStabilityScore(input.stabilityDays);
  const retrievalScore = computeRetrievalScore(
    input.retrievalStrength,
    input.stabilityDays,
    input.lastPracticedAt,
    nowIso,
  );
  const exposureScore = computeExposureScore(input.exposureCount);

  const mastery = clamp01(
    recentScore * W.recent +
      historicalScore * W.historical +
      stabilityScore * W.stability +
      retrievalScore * W.retrieval +
      exposureScore * W.exposure,
  );

  return {
    recentScore: round4(recentScore),
    historicalScore: round4(historicalScore),
    stabilityScore: round4(stabilityScore),
    retrievalScore: round4(retrievalScore),
    exposureScore: round4(exposureScore),
    mastery: round4(mastery),
  };
}

export function masteryFromState(state: LearnerState, nowIso: string): MasteryBreakdown {
  return computeMastery(
    {
      recentEvidence: state.recentEvidence,
      successfulAttempts: state.successfulAttempts,
      failedAttempts: state.failedAttempts,
      stabilityDays: state.stabilityDays,
      retrievalStrength: state.retrievalStrength,
      exposureCount: state.exposureCount,
      lastPracticedAt: state.lastPracticedAt,
    },
    nowIso,
  );
}
