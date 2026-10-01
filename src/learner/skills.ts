import type { LearnerState } from '@/domain/entities';
import type { ActivityType, Modality, SkillKind } from '@/domain/enums';
import { LEARNER_PARAMS as P } from './params';

/**
 * Maps measured evidence to the skills it actually informs.
 * Language-agnostic: no English-specific rules here.
 */
export function modalityToSkills(
  modality: Modality,
  activityType: ActivityType | null,
): SkillKind[] {
  switch (modality) {
    case 'recognition':
      return ['vocabulary', 'reading'];
    case 'recall':
      return ['vocabulary'];
    case 'production':
      if (activityType === 'conversation' || activityType === 'pronunciation') {
        return ['speaking', 'vocabulary'];
      }
      if (activityType === 'grammar_practice') return ['grammar', 'writing'];
      return ['writing', 'vocabulary'];
    case 'listening':
      return ['listening'];
    case 'transfer':
      return ['interaction'];
    default:
      return [];
  }
}

export interface ErrorPattern {
  modality: Modality;
  attempts: number;
  successRate: number;
  strength: number;
}

/**
 * Error patterns are derived from measured modalities only. A high recognition
 * score with low production is exactly the case where the system must stop
 * serving more recognition drills (PRD §7.3).
 */
export function detectErrorPatterns(state: LearnerState): ErrorPattern[] {
  const patterns: ErrorPattern[] = [];
  for (const [modality, stat] of Object.entries(state.modalityStats)) {
    if (!stat || stat.attempts === 0) continue;
    const successRate = stat.successes / stat.attempts;
    if (successRate < P.successThreshold) {
      patterns.push({
        modality: modality as Modality,
        attempts: stat.attempts,
        successRate: Math.round(successRate * 10000) / 10000,
        strength: stat.strength,
      });
    }
  }
  return patterns.sort((a, b) => a.successRate - b.successRate);
}

/**
 * Returns the modality that deserves the next measurement: the one with the
 * least evidence, preferring production over recognition when recognition is
 * already strong.
 */
export function nextUsefulModality(state: LearnerState): Modality {
  const recognition = state.modalityStats.recognition;
  const recall = state.modalityStats.recall;
  const production = state.modalityStats.production;

  const recognitionStrength = recognition?.strength ?? 0;
  const recallStrength = recall?.strength ?? 0;

  if (!recognition || recognition.attempts === 0) return 'recognition';
  if (recognitionStrength >= 0.6 && (!recall || recall.attempts === 0)) return 'recall';
  if (recallStrength >= 0.6 && (!production || production.attempts === 0)) return 'production';
  if (recognitionStrength >= 0.6 && recallStrength < recognitionStrength) return 'recall';
  return 'recognition';
}

export function strengthFor(state: LearnerState, modality: Modality): number | null {
  const stat = state.modalityStats[modality];
  if (!stat || stat.attempts === 0) return null;
  return stat.strength;
}
