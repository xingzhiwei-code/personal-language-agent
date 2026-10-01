import type { Evidence, LearnerState, ModalityStat } from '@/domain/entities';
import type { Modality, SubjectType, Trend } from '@/domain/enums';
import { computeConfidence } from './confidence';
import { computeMastery } from './mastery';
import { LEARNER_PARAMS as P, clamp01, round4 } from './params';
import { addDays, scheduleNext } from './srs';

export interface CreateStateInput {
  id: string;
  learnerId: string;
  subjectType: SubjectType;
  subjectId: string;
  nowIso: string;
}

/**
 * A brand new state is explicitly *unknown*: mastery 0 and a near-zero
 * confidence. The system must not pretend it already understands the learner
 * (PRD §F-02 / §7.3).
 */
export function createInitialState(input: CreateStateInput): LearnerState {
  return {
    id: input.id,
    learnerId: input.learnerId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    mastery: 0,
    confidence: round4(P.confidenceFloor),
    exposureCount: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    recentPerformance: 0,
    historicalPerformance: 0,
    stabilityDays: 0,
    easeFactor: P.easeDefault,
    repetitions: 0,
    retrievalStrength: 0,
    modalityStats: {},
    recentEvidence: [],
    transferScore: null,
    transferConfidence: null,
    trend: 'unknown',
    lastPracticedAt: null,
    nextReviewAt: null,
    userDeclaredMastered: false,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}

function updateModalityStat(
  previous: ModalityStat | undefined,
  score: number,
  occurredAt: string,
): ModalityStat {
  const attempts = (previous?.attempts ?? 0) + 1;
  const successes = (previous?.successes ?? 0) + (score >= P.successThreshold ? 1 : 0);
  // Prior-shrunk success ratio: one attempt never means "fully strong".
  const strength = clamp01(
    (successes + P.modalityPriorWeight * P.priorMean) / (attempts + P.modalityPriorWeight),
  );
  return { attempts, successes, strength: round4(strength), lastAt: occurredAt };
}

export function computeTrend(recentEvidence: readonly Evidence[]): Trend {
  if (recentEvidence.length < P.trendMinEvidence) return 'unknown';
  const sorted = [...recentEvidence].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
  const half = Math.floor(sorted.length / 2);
  const newer = sorted.slice(0, half);
  const older = sorted.slice(half);
  const mean = (list: Evidence[]): number =>
    list.reduce((sum, item) => sum + clamp01(item.score), 0) / Math.max(1, list.length);
  const delta = mean(newer) - mean(older);
  if (delta >= P.trendDelta) return 'improving';
  if (delta <= -P.trendDelta) return 'declining';
  return 'stable';
}

export interface ApplyEvidenceInput {
  modality: Modality;
  score: number;
  difficulty?: number | null;
  occurredAt: string;
}

/**
 * Pure state transition: LearningEvent/Assessment (fact) -> LearnerState
 * (current estimate). Fully deterministic; never calls an LLM.
 */
export function applyEvidence(
  state: LearnerState,
  input: ApplyEvidenceInput,
  nowIso: string,
): LearnerState {
  const score = clamp01(input.score);
  const evidence: Evidence = {
    modality: input.modality,
    score: round4(score),
    difficulty: input.difficulty == null ? null : clamp01(input.difficulty),
    occurredAt: input.occurredAt,
  };

  const recentEvidence = [evidence, ...state.recentEvidence]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, P.evidenceWindow);

  const success = score >= P.successThreshold;
  const successfulAttempts = state.successfulAttempts + (success ? 1 : 0);
  const failedAttempts = state.failedAttempts + (success ? 0 : 1);
  const exposureCount = state.exposureCount + 1;

  const srs = scheduleNext(
    {
      easeFactor: state.easeFactor,
      intervalDays: state.stabilityDays,
      repetitions: state.repetitions,
      retrievalStrength: state.retrievalStrength,
    },
    score,
    input.occurredAt,
  );

  const modalityStats = {
    ...state.modalityStats,
    [input.modality]: updateModalityStat(
      state.modalityStats[input.modality],
      score,
      input.occurredAt,
    ),
  };

  const breakdown = computeMastery(
    {
      recentEvidence,
      successfulAttempts,
      failedAttempts,
      stabilityDays: srs.intervalDays,
      retrievalStrength: srs.retrievalStrength,
      exposureCount,
      lastPracticedAt: input.occurredAt,
    },
    nowIso,
  );
  const confidence = computeConfidence(recentEvidence, nowIso);

  return {
    ...state,
    exposureCount,
    successfulAttempts,
    failedAttempts,
    recentEvidence,
    modalityStats,
    easeFactor: srs.easeFactor,
    repetitions: srs.repetitions,
    stabilityDays: srs.intervalDays,
    retrievalStrength: srs.retrievalStrength,
    nextReviewAt: srs.nextReviewAt,
    lastPracticedAt: input.occurredAt,
    recentPerformance: breakdown.recentScore,
    historicalPerformance: breakdown.historicalScore,
    mastery: breakdown.mastery,
    confidence: confidence.confidence,
    trend: computeTrend(recentEvidence),
    updatedAt: nowIso,
  };
}

/**
 * Removes one previously applied evidence (used when the learner corrects the
 * system's judgement). Counters are decremented and the estimate recomputed.
 */
export function revertEvidence(
  state: LearnerState,
  target: { modality: Modality; occurredAt: string },
  nowIso: string,
): LearnerState {
  const index = state.recentEvidence.findIndex(
    (evidence) =>
      evidence.modality === target.modality && evidence.occurredAt === target.occurredAt,
  );
  const recentEvidence =
    index >= 0
      ? state.recentEvidence.filter((_, position) => position !== index)
      : [...state.recentEvidence];
  const removed = index >= 0 ? state.recentEvidence[index] : undefined;
  const wasSuccess = removed ? removed.score >= P.successThreshold : false;

  const successfulAttempts = Math.max(0, state.successfulAttempts - (wasSuccess ? 1 : 0));
  const failedAttempts = Math.max(0, state.failedAttempts - (wasSuccess ? 0 : 1));
  const exposureCount = Math.max(0, state.exposureCount - 1);

  const modalityStats = { ...state.modalityStats };
  const stat = modalityStats[target.modality];
  if (stat) {
    const attempts = Math.max(0, stat.attempts - 1);
    const successes = Math.max(0, stat.successes - (wasSuccess ? 1 : 0));
    modalityStats[target.modality] = {
      attempts,
      successes,
      strength: round4(
        clamp01(
          (successes + P.modalityPriorWeight * P.priorMean) /
            (attempts + P.modalityPriorWeight),
        ),
      ),
      lastAt: stat.lastAt,
    };
  }

  const breakdown = computeMastery(
    {
      recentEvidence,
      successfulAttempts,
      failedAttempts,
      stabilityDays: state.stabilityDays,
      retrievalStrength: state.retrievalStrength,
      exposureCount,
      lastPracticedAt: state.lastPracticedAt,
    },
    nowIso,
  );
  const confidence = computeConfidence(recentEvidence, nowIso);

  return {
    ...state,
    recentEvidence,
    successfulAttempts,
    failedAttempts,
    exposureCount,
    modalityStats,
    mastery: breakdown.mastery,
    recentPerformance: breakdown.recentScore,
    historicalPerformance: breakdown.historicalScore,
    confidence: confidence.confidence,
    trend: computeTrend(recentEvidence),
    updatedAt: nowIso,
  };
}

/**
 * "I already know this." We never argue with the learner: the estimate is
 * raised and review pushed out, but confidence stays capped because a
 * self-report is weaker evidence than a measured retrieval (PRD §5.1).
 */
export function applyUserDeclaredMastery(
  state: LearnerState,
  nowIso: string,
): LearnerState {
  return {
    ...state,
    userDeclaredMastered: true,
    mastery: round4(Math.max(state.mastery, P.userDeclaredMasteryFloor)),
    confidence: round4(Math.min(state.confidence, P.userDeclaredConfidenceCap)),
    stabilityDays: Math.max(state.stabilityDays, P.userDeclaredIntervalDays),
    nextReviewAt: addDays(nowIso, P.userDeclaredIntervalDays),
    updatedAt: nowIso,
  };
}

/** "Not relevant / wrong detection": stop scheduling without faking mastery. */
export function applyNotRelevant(state: LearnerState, nowIso: string): LearnerState {
  return {
    ...state,
    nextReviewAt: null,
    updatedAt: nowIso,
  };
}

export interface TransferInput {
  score: number;
  confidence: number;
}

/**
 * Transfer is tracked separately from in-app mastery and is only set when real
 * transfer evidence exists (PRD §7.4).
 */
export function applyTransferEvidence(
  state: LearnerState,
  input: TransferInput,
  nowIso: string,
): LearnerState {
  const previousScore = state.transferScore ?? 0;
  const previousConfidence = state.transferConfidence ?? 0;
  const weight = clamp01(input.confidence);
  const score = clamp01(input.score);

  // Confidence-weighted average of transfer observations.
  const totalWeight = previousConfidence + weight;
  const blendedScore =
    totalWeight <= 0 ? score : (previousScore * previousConfidence + score * weight) / totalWeight;
  // Independent observations accumulate with diminishing returns.
  const blendedConfidence = clamp01(previousConfidence + weight * (1 - previousConfidence));

  return {
    ...state,
    transferScore: round4(clamp01(blendedScore)),
    transferConfidence: round4(blendedConfidence),
    updatedAt: nowIso,
  };
}
