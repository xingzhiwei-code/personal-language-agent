/**
 * All tunable parameters of the learner model live here — and nowhere else.
 * No UI, API handler or agent prompt is allowed to re-implement these numbers
 * (PRD §7.2: "权重集中在一个可测试模块").
 */

export const MASTERY_WEIGHTS = {
  recent: 0.3,
  historical: 0.2,
  stability: 0.2,
  retrieval: 0.2,
  exposure: 0.1,
} as const;

/** Sanity check: the weights must sum to 1. */
export const MASTERY_WEIGHT_SUM =
  MASTERY_WEIGHTS.recent +
  MASTERY_WEIGHTS.historical +
  MASTERY_WEIGHTS.stability +
  MASTERY_WEIGHTS.retrieval +
  MASTERY_WEIGHTS.exposure;

export const LEARNER_PARAMS = {
  /** Number of recent evidences considered by `recentScore`. */
  recentWindow: 8,
  /** Max evidences persisted on the state (older facts stay in the event log). */
  evidenceWindow: 12,
  /** Recency half-life (days) applied to recent evidence. */
  recentHalfLifeDays: 14,
  /** Extra decay per position so the newest evidence dominates. */
  recentPositionDecay: 0.85,

  /**
   * Bayesian-style priors. A single correct answer must not produce a
   * near-perfect estimate, so every ratio is shrunk toward a low prior mean.
   */
  priorMean: 0.2,
  recentPriorWeight: 1.5,
  historicalPriorWeight: 3,
  modalityPriorWeight: 1,

  /** `stabilityScore = 1 - exp(-stabilityDays / stabilityScaleDays)` */
  stabilityScaleDays: 30,
  /** `exposureScore = 1 - exp(-exposureCount / exposureScale)` */
  exposureScale: 8,

  /** SRS (SM-2 lite). */
  easeDefault: 2.5,
  easeMin: 1.3,
  easeMax: 3.2,
  failureEasePenalty: 0.2,
  firstIntervalDays: 1,
  secondIntervalDays: 3,
  relearnIntervalDays: 0.5,
  maxIntervalDays: 180,
  /** A score at or above this counts as a successful retrieval. */
  successThreshold: 0.6,

  retrievalBase: 0.35,
  retrievalPerRepetition: 0.13,
  retrievalFailureDecay: 0.5,
  retrievalFailureFloor: 0.1,

  /** Confidence model. */
  confidenceFloor: 0.05,
  confidenceVolumeWeight: 0.35,
  confidenceDiversityWeight: 0.25,
  confidenceConsistencyWeight: 0.2,
  confidenceRecencyWeight: 0.2,
  /** Per-modality saturation: repeating the same drill has diminishing value. */
  confidenceModalitySaturation: 2,
  confidenceTargetEffectiveEvidence: 3,
  confidenceRecencyHalfLifeDays: 30,

  /** Trend detection needs at least this many evidences. */
  trendMinEvidence: 4,
  trendDelta: 0.12,

  /** Self-reported mastery ("I already know this"). */
  userDeclaredMasteryFloor: 0.6,
  userDeclaredConfidenceCap: 0.45,
  userDeclaredIntervalDays: 14,
} as const;

export const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : Number.isFinite(value) ? value : 0;

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Rounds to 4 decimals so persisted state stays stable and comparable. */
export const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export const daysBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / 86_400_000);
};
