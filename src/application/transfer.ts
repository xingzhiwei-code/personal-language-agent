import type { LearnerState, TransferEvidence } from '@/domain/entities';
import type { SubjectType, TransferEvidenceType } from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { applyTransferEvidence } from '@/learner/state';
import { appendEvent } from './events';
import { loadOrCreateState, saveState } from './learner-state';
import type { AppContext } from './types';

export interface RecordTransferInput {
  learnerId: string;
  subjectType: SubjectType;
  subjectId: string;
  scenario: string;
  evidenceType: TransferEvidenceType;
  score: number;
  goalId?: string | null;
  note?: string | null;
}

/**
 * Real-world transfer is tracked separately from in-app mastery. Confidence is
 * derived from the evidence type: a self-report is weaker than an observed or
 * externally tested outcome (PRD §7.4).
 */
const CONFIDENCE_BY_TYPE: Record<TransferEvidenceType, number> = {
  self_report: 0.35,
  real_world_log: 0.6,
  observed: 0.75,
  external_test: 0.85,
};

export async function recordTransferEvidence(
  ctx: AppContext,
  input: RecordTransferInput,
): Promise<{ evidence: TransferEvidence; state: LearnerState }> {
  if (input.score < 0 || input.score > 1 || !Number.isFinite(input.score)) {
    throw validationFailed('score 必须在 0 到 1 之间');
  }
  if (input.scenario.trim().length === 0) {
    throw validationFailed('请描述发生的真实场景');
  }

  const now = ctx.clock.nowIso();
  const confidence = CONFIDENCE_BY_TYPE[input.evidenceType];
  const evidence: TransferEvidence = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    goalId: input.goalId ?? null,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    scenario: input.scenario.trim(),
    evidenceType: input.evidenceType,
    score: input.score,
    confidence,
    note: input.note ?? null,
    occurredAt: now,
    createdAt: now,
  };
  await ctx.repos.transfer.create(evidence);

  const state = await loadOrCreateState(
    ctx,
    input.learnerId,
    input.subjectType,
    input.subjectId,
  );
  const updated = await saveState(
    ctx,
    applyTransferEvidence(state, { score: input.score, confidence }, now),
  );

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'transfer_reported',
    source: 'user',
    idempotencyKey: `transfer:${evidence.id}`,
    payload: {
      subjectId: input.subjectId,
      scenario: evidence.scenario,
      evidenceType: input.evidenceType,
      score: input.score,
    },
  });

  return { evidence, state: updated };
}

export async function getTransferEvidence(
  ctx: AppContext,
  learnerId: string,
  limit = 50,
): Promise<TransferEvidence[]> {
  return ctx.repos.transfer.listByLearner(learnerId, limit);
}
