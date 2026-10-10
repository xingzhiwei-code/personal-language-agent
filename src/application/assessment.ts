import type { Assessment, LearnerState } from '@/domain/entities';
import type {
  ActivityType,
  EventSource,
  Modality,
  SkillKind,
  SubjectType,
} from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { LEARNER_PARAMS } from '@/learner/params';
import { modalityToSkills } from '@/learner/skills';
import { applyEvidence, revertEvidence } from '@/learner/state';
import { appendEvent } from './events';
import { loadOrCreateState, saveState } from './learner-state';
import type { AppContext } from './types';

export interface SubmitAssessmentInput {
  learnerId: string;
  subjectType: SubjectType;
  subjectId: string;
  modality: Modality;
  /** 0..1. Graders live in the review/agent layer, never in the learner model. */
  score: number;
  sessionId?: string | null;
  activityId?: string | null;
  activityType?: ActivityType | null;
  difficulty?: number | null;
  responseTimeMs?: number | null;
  userAnswer?: string | null;
  expectedAnswer?: string | null;
  source?: EventSource;
  /** Required: guarantees a retried submit does not count twice. */
  idempotencyKey: string;
  /** Overrides the default modality -> skill mapping when known. */
  skills?: SkillKind[];
  /**
   * When true, the assessment fact is recorded but the LearnerState (mastery)
   * is NOT updated. Used by placement sessions — measurement, not learning
   * (v0.4 §G1).
   */
  skipStateUpdate?: boolean;
}

export interface SubmitAssessmentResult {
  assessment: Assessment;
  state: LearnerState;
  skillStates: LearnerState[];
  /** False when the same idempotency key was already processed. */
  created: boolean;
}

/**
 * The single write path for learning evidence:
 *
 *   Assessment (fact) -> LearningEvent (append-only) -> LearnerState (estimate)
 *
 * Fully deterministic. No LLM is involved in scoring aggregation (PRD §10.5).
 */
export async function submitAssessment(
  ctx: AppContext,
  input: SubmitAssessmentInput,
): Promise<SubmitAssessmentResult> {
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 1) {
    throw validationFailed('score must be a number between 0 and 1', { score: input.score });
  }
  if (input.subjectId.trim().length === 0) {
    throw validationFailed('subjectId is required');
  }

  const now = ctx.clock.nowIso();
  const { event, created } = await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'assessment_recorded',
    source: input.source ?? 'user',
    sessionId: input.sessionId ?? null,
    idempotencyKey: input.idempotencyKey,
    payload: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      modality: input.modality,
      score: input.score,
      activityId: input.activityId ?? null,
      activityType: input.activityType ?? null,
    },
  });

  if (!created) {
    // Duplicate submission: return the stored result without re-applying it.
    const existing = await ctx.repos.assessments.findByEventId(event.id);
    const state = await loadOrCreateState(
      ctx,
      input.learnerId,
      input.subjectType,
      input.subjectId,
    );
    if (existing) {
      return { assessment: existing, state, skillStates: [], created: false };
    }
  }

  const assessment: Assessment = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    eventId: event.id,
    sessionId: input.sessionId ?? null,
    activityId: input.activityId ?? null,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    modality: input.modality,
    score: input.score,
    correct: input.score >= LEARNER_PARAMS.successThreshold,
    difficulty: input.difficulty ?? null,
    responseTimeMs: input.responseTimeMs ?? null,
    userAnswer: input.userAnswer ?? null,
    expectedAnswer: input.expectedAnswer ?? null,
    source: input.source ?? 'user',
    userCorrected: false,
    occurredAt: event.occurredAt,
  };
  await ctx.repos.assessments.create(assessment);

  // Placement (v0.4 §G1): record the fact, but never learn from it. Mastery and
  // skill states must not move on a measurement session.
  if (input.skipStateUpdate) {
    const untouched = await loadOrCreateState(
      ctx,
      input.learnerId,
      input.subjectType,
      input.subjectId,
    );
    return { assessment, state: untouched, skillStates: [], created: true };
  }

  const subjectState = await loadOrCreateState(
    ctx,
    input.learnerId,
    input.subjectType,
    input.subjectId,
  );
  const updated = await saveState(
    ctx,
    applyEvidence(
      subjectState,
      {
        modality: input.modality,
        score: input.score,
        difficulty: input.difficulty ?? null,
        occurredAt: event.occurredAt,
      },
      now,
    ),
  );

  // Aggregate the same evidence at skill level so the scheduler can reason
  // about weak skills without scanning every knowledge item.
  const skills =
    input.skills ?? modalityToSkills(input.modality, input.activityType ?? null);
  const skillStates: LearnerState[] = [];
  for (const skill of skills) {
    const state = await loadOrCreateState(ctx, input.learnerId, 'skill', skill);
    skillStates.push(
      await saveState(
        ctx,
        applyEvidence(
          state,
          {
            modality: input.modality,
            score: input.score,
            difficulty: input.difficulty ?? null,
            occurredAt: event.occurredAt,
          },
          now,
        ),
      ),
    );
  }

  return { assessment, state: updated, skillStates, created: true };
}

export interface CorrectAssessmentInput {
  learnerId: string;
  assessmentId: string;
  /** The score the learner says is right (e.g. 1 for "I was actually correct"). */
  correctedScore: number;
}

/**
 * "The system judged me wrong." The learner always wins: the old evidence is
 * reverted and the corrected one applied, and the correction is recorded as an
 * event so the change is traceable.
 */
export async function correctAssessment(
  ctx: AppContext,
  input: CorrectAssessmentInput,
): Promise<{ assessment: Assessment; state: LearnerState }> {
  const assessment = await ctx.repos.assessments.findById(input.assessmentId);
  if (!assessment || assessment.learnerId !== input.learnerId) {
    throw validationFailed('assessment not found', { id: input.assessmentId });
  }
  if (!Number.isFinite(input.correctedScore) || input.correctedScore < 0 || input.correctedScore > 1) {
    throw validationFailed('correctedScore must be between 0 and 1');
  }

  const now = ctx.clock.nowIso();
  const { created } = await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'user_feedback',
    source: 'user',
    sessionId: assessment.sessionId,
    idempotencyKey: `assessment-correction:${assessment.id}:${input.correctedScore}`,
    payload: {
      kind: 'assessment_corrected',
      assessmentId: assessment.id,
      previousScore: assessment.score,
      correctedScore: input.correctedScore,
    },
  });

  const state = await loadOrCreateState(
    ctx,
    input.learnerId,
    assessment.subjectType,
    assessment.subjectId,
  );

  if (!created) {
    return { assessment, state };
  }

  const reverted = revertEvidence(
    state,
    { modality: assessment.modality, occurredAt: assessment.occurredAt },
    now,
  );
  const reapplied = applyEvidence(
    reverted,
    {
      modality: assessment.modality,
      score: input.correctedScore,
      difficulty: assessment.difficulty,
      occurredAt: assessment.occurredAt,
    },
    now,
  );
  const saved = await saveState(ctx, reapplied);

  const updatedAssessment: Assessment = {
    ...assessment,
    score: input.correctedScore,
    correct: input.correctedScore >= LEARNER_PARAMS.successThreshold,
    userCorrected: true,
  };
  await ctx.repos.assessments.update(updatedAssessment);

  return { assessment: updatedAssessment, state: saved };
}
