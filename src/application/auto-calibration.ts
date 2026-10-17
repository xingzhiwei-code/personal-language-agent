import {
  AUTO_CALIBRATION_ACKNOWLEDGED_KEY,
  AUTO_CALIBRATION_PREFERENCE_KEY,
  CALIBRATION_LEARNING_DAY_WINDOW,
  CALIBRATION_MASTERY_THRESHOLD,
  CALIBRATION_MAX_STEP,
  CALIBRATION_TRIGGER_THRESHOLD,
} from '@/config/v05';
import type { Placement } from '@/domain/entities';
import type { PlacementConfidence } from '@/domain/enums';
import { localDayKey } from './local-day';
import { recordPlacement, scoreToBand } from './placement';
import { setPreference } from './memory';
import type { AppContext } from './types';

/**
 * v0.5 §W3 — starting-level auto-calibration.
 *
 * Deterministic only: no LLM, no runtime model call. The estimate is a
 * hypothesis (宪法#8) with confidence; it is NEVER applied silently — it must
 * be confirmed by the user (ADR-010/011 inference red line). A manual override
 * always wins and pauses auto-calibration until re-enabled.
 */

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export interface CalibrationEvidence {
  /** Mastery values (0..1) of items practised within the window. */
  masteryValues: number[];
  /** Assessment scores (0..1) within the window. */
  assessmentScores: number[];
  /** Number of distinct learning days observed. */
  learningDayCount: number;
}

export interface CalibrationEstimate {
  value: number;
  confidence: PlacementConfidence;
  evidenceCount: number;
}

/**
 * Deterministic estimate from recent learning evidence: the mastered-ratio and
 * the review accuracy each contribute equally; the result maps to the internal
 * 0–9 band (half steps). Confidence rises with evidence volume.
 */
export function estimateBand(evidence: CalibrationEvidence): CalibrationEstimate | null {
  const { masteryValues, assessmentScores } = evidence;

  const masteredRatio =
    masteryValues.length > 0
      ? masteryValues.filter((value) => value >= CALIBRATION_MASTERY_THRESHOLD).length /
        masteryValues.length
      : null;
  const accuracy =
    assessmentScores.length > 0
      ? assessmentScores.reduce((sum, value) => sum + value, 0) / assessmentScores.length
      : null;

  const signals = [masteredRatio, accuracy].filter((value): value is number => value !== null);
  if (signals.length === 0) return null;

  const composite = signals.reduce((sum, value) => sum + value, 0) / signals.length;
  const value = scoreToBand(composite);
  const evidenceCount = masteryValues.length + assessmentScores.length;
  const confidence: PlacementConfidence =
    evidenceCount < 20 ? 'low' : evidenceCount < 100 ? 'medium' : 'high';

  return { value, confidence, evidenceCount };
}

export interface CalibrationSuggestion {
  /** The (amplitude-protected) band to offer the user. */
  suggestedValue: number;
  currentValue: number;
  /** Actual change applied after the amplitude cap. */
  delta: number;
}

/**
 * Trigger + amplitude protection (v0.5 §W3): a suggestion is produced only when
 * |estimated − current| ≥ trigger, and the single-step change never exceeds
 * `CALIBRATION_MAX_STEP` (anti-jitter).
 */
export function computeCalibrationSuggestion(
  estimated: number,
  current: number,
): CalibrationSuggestion | null {
  const delta = estimated - current;
  if (Math.abs(delta) < CALIBRATION_TRIGGER_THRESHOLD) return null;
  const clamped = Math.max(-CALIBRATION_MAX_STEP, Math.min(CALIBRATION_MAX_STEP, delta));
  return {
    suggestedValue: roundHalf(current + clamped),
    currentValue: current,
    delta: clamped,
  };
}

/** Honest data-window label, e.g. "近14天学习数据". */
export function basedOnLabel(): string {
  return `近${CALIBRATION_LEARNING_DAY_WINDOW}天学习数据`;
}

/** The switch is stored as a user-explicit preference; default off (宪法#10). */
export async function isAutoCalibrationEnabled(
  ctx: AppContext,
  learnerId: string,
): Promise<boolean> {
  const preference = await ctx.repos.preferences.findByKey(
    learnerId,
    AUTO_CALIBRATION_PREFERENCE_KEY,
  );
  return preference?.value === 'true';
}

export async function setAutoCalibrationEnabled(
  ctx: AppContext,
  learnerId: string,
  enabled: boolean,
): Promise<void> {
  await setPreference(ctx, {
    learnerId,
    key: AUTO_CALIBRATION_PREFERENCE_KEY,
    value: enabled ? 'true' : 'false',
    source: 'user_explicit',
  });
}

/** Manual override wins and pauses auto-calibration (v0.5 §W3). */
export async function pauseAutoCalibration(ctx: AppContext, learnerId: string): Promise<void> {
  await setPreference(ctx, {
    learnerId,
    key: AUTO_CALIBRATION_PREFERENCE_KEY,
    value: 'false',
    source: 'user_explicit',
  });
}

/**
 * Window start for the last N learning days. A learning day is a distinct
 * natural day with a completed non-placement session (same definition as the
 * daily-one-topic rotation).
 */
async function computeLearningWindowStart(ctx: AppContext, learnerId: string): Promise<{
  startIso: string;
  learningDayCount: number;
}> {
  const completed = await ctx.repos.sessions.listByLearner(learnerId, 2000, ['completed']);
  const days = [...new Set(
    completed
      .filter((session) => session.activityType !== 'placement')
      .map((session) => localDayKey(session.endedAt ?? session.updatedAt)),
  )].sort()
    .reverse();

  if (days.length === 0) {
    return { startIso: ctx.clock.nowIso(), learningDayCount: 0 };
  }
  const index = Math.min(CALIBRATION_LEARNING_DAY_WINDOW - 1, days.length - 1);
  return { startIso: `${days[index]!}T00:00:00.000Z`, learningDayCount: days.length };
}

export async function collectCalibrationEvidence(
  ctx: AppContext,
  learnerId: string,
): Promise<CalibrationEvidence> {
  const { startIso, learningDayCount } = await computeLearningWindowStart(ctx, learnerId);

  const [states, assessments] = await Promise.all([
    ctx.repos.states.listBySubjectType(learnerId, 'knowledge_item'),
    ctx.repos.assessments.listByLearner(learnerId, 10_000),
  ]);

  const masteryValues = states
    .filter((state) => state.lastPracticedAt !== null && state.lastPracticedAt >= startIso)
    .map((state) => state.mastery);
  const assessmentScores = assessments
    .filter((assessment) => assessment.occurredAt >= startIso)
    .map((assessment) => assessment.score);

  return { masteryValues, assessmentScores, learningDayCount };
}

export interface AutoCalibrationView {
  enabled: boolean;
  /** Non-null only when a suggestion should be surfaced (switch on + threshold met). */
  suggestion: CalibrationSuggestion & { confidence: PlacementConfidence; basedOn: string } | null;
  /** History of applied auto-calibration placements, newest first. */
  history: Placement[];
}

/**
 * The read path for the goal page: computes the current suggestion (if any) and
 * the read-only history. The switch is honoured here — when off, no suggestion.
 */
export async function getAutoCalibrationView(
  ctx: AppContext,
  learnerId: string,
): Promise<AutoCalibrationView> {
  const enabled = await isAutoCalibrationEnabled(ctx, learnerId);
  const placements = await ctx.repos.placements.listByLearner(learnerId, 50);
  const history = placements.filter((placement) => placement.type === 'auto_calibration');
  const latest = placements[0] ?? null;
  const currentValue = latest?.overallLevel ?? 0;

  if (!enabled || !latest) {
    return { enabled, suggestion: null, history };
  }

  const evidence = await collectCalibrationEvidence(ctx, learnerId);
  if (evidence.learningDayCount < CALIBRATION_LEARNING_DAY_WINDOW) {
    return { enabled, suggestion: null, history };
  }

  const estimate = estimateBand(evidence);
  if (!estimate) {
    return { enabled, suggestion: null, history };
  }

  const suggestion = computeCalibrationSuggestion(estimate.value, currentValue);
  if (!suggestion) {
    return { enabled, suggestion: null, history };
  }

  // One suggestion per estimate change: if the user already acknowledged this
  // exact value (保持不变), do not nag again.
  const acknowledged = await ctx.repos.preferences.findByKey(
    learnerId,
    AUTO_CALIBRATION_ACKNOWLEDGED_KEY,
  );
  if (acknowledged?.value === String(suggestion.suggestedValue)) {
    return { enabled, suggestion: null, history };
  }

  return {
    enabled,
    suggestion: {
      ...suggestion,
      confidence: estimate.confidence,
      basedOn: basedOnLabel(),
    },
    history,
  };
}

/** Records "保持不变" so the same suggestion is not re-surfaced. */
export async function acknowledgeAutoCalibration(
  ctx: AppContext,
  learnerId: string,
  suggestedValue: number,
): Promise<void> {
  await setPreference(ctx, {
    learnerId,
    key: AUTO_CALIBRATION_ACKNOWLEDGED_KEY,
    value: String(suggestedValue),
    source: 'user_explicit',
  });
}

/** Applies the user-confirmed calibration (更新). Idempotent per call. */
export async function applyAutoCalibration(
  ctx: AppContext,
  learnerId: string,
  suggestedValue: number,
  confidence: PlacementConfidence,
): Promise<Placement | null> {
  return recordPlacement(ctx, {
    learnerId,
    type: 'auto_calibration',
    skills: { vocabulary: null, spelling: null, listening: null, writtenExpression: null },
    overallLevel: Math.max(0, Math.min(9, suggestedValue)),
    confidence,
    evidence: ['auto_calibration'],
    idempotencyKey: `placement:auto-calibration:${ctx.clock.nowIso()}`,
  });
}
