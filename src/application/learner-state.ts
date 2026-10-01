import type { LearnerState } from '@/domain/entities';
import type { SubjectType } from '@/domain/enums';
import { createInitialState } from '@/learner/state';
import type { AppContext } from './types';

/** Loads a learner state, creating a fresh (unknown) one when missing. */
export async function loadOrCreateState(
  ctx: AppContext,
  learnerId: string,
  subjectType: SubjectType,
  subjectId: string,
): Promise<LearnerState> {
  const existing = await ctx.repos.states.find(learnerId, subjectType, subjectId);
  if (existing) return existing;
  return createInitialState({
    id: ctx.ids.next(),
    learnerId,
    subjectType,
    subjectId,
    nowIso: ctx.clock.nowIso(),
  });
}

export async function saveState(ctx: AppContext, state: LearnerState): Promise<LearnerState> {
  return ctx.repos.states.upsert(state);
}
