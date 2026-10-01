import type { Evidence } from '@/domain/entities';
import type { Modality } from '@/domain/enums';
import { LEARNER_PARAMS as P, clamp01, daysBetween, round4 } from './params';

export interface ConfidenceBreakdown {
  volume: number;
  diversity: number;
  consistency: number;
  recency: number;
  effectiveEvidence: number;
  confidence: number;
}

/**
 * Confidence is *not* mastery: it expresses how sure the system is about its
 * own estimate. Independent, diverse evidence increases it; repeating the same
 * drill type has strongly diminishing marginal value (PRD §7.3).
 */
export function computeConfidence(
  recentEvidence: readonly Evidence[],
  nowIso: string,
): ConfidenceBreakdown {
  if (recentEvidence.length === 0) {
    return {
      volume: 0,
      diversity: 0,
      consistency: 0,
      recency: 0,
      effectiveEvidence: 0,
      confidence: round4(P.confidenceFloor),
    };
  }

  const byModality = new Map<Modality, Evidence[]>();
  for (const evidence of recentEvidence) {
    const bucket = byModality.get(evidence.modality);
    if (bucket) bucket.push(evidence);
    else byModality.set(evidence.modality, [evidence]);
  }

  // Each modality saturates near 1, so the 20th recognition drill adds ~nothing.
  let effectiveEvidence = 0;
  for (const bucket of byModality.values()) {
    effectiveEvidence += 1 - Math.exp(-bucket.length / P.confidenceModalitySaturation);
  }

  const volume = clamp01(effectiveEvidence / P.confidenceTargetEffectiveEvidence);
  const diversity = clamp01((byModality.size - 1) / 3);

  const scores = recentEvidence.map((evidence) => clamp01(evidence.score));
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  // Max variance for values in [0,1] is 0.25 -> normalise, then invert.
  const consistency = scores.length < 2 ? 0 : clamp01(1 - variance / 0.25);

  const newest = recentEvidence.reduce(
    (latest, evidence) =>
      Date.parse(evidence.occurredAt) > Date.parse(latest.occurredAt) ? evidence : latest,
    recentEvidence[0] as Evidence,
  );
  const ageDays = daysBetween(newest.occurredAt, nowIso);
  const recency = clamp01(Math.pow(0.5, ageDays / P.confidenceRecencyHalfLifeDays));

  const confidence = clamp01(
    P.confidenceFloor +
      volume * P.confidenceVolumeWeight +
      diversity * P.confidenceDiversityWeight +
      consistency * P.confidenceConsistencyWeight +
      recency * P.confidenceRecencyWeight,
  );

  return {
    volume: round4(volume),
    diversity: round4(diversity),
    consistency: round4(consistency),
    recency: round4(recency),
    effectiveEvidence: round4(effectiveEvidence),
    confidence: round4(confidence),
  };
}
