import type { Goal, LearningTarget, User } from '@/domain/entities';
import type { GoalStatus } from '@/domain/enums';
import { notFound, validationFailed } from '@/domain/errors';
import { createInitialState } from '@/learner/state';
import { parseGoalInput } from '@/nlu/goal';
import { appendEvent } from './events';
import { LOCAL_LEARNER_ID, type AppContext } from './types';

const DUPLICATE_WINDOW_MS = 60_000;

/** Ensures the single local learner exists. Called by every entry point. */
export async function ensureLearner(ctx: AppContext): Promise<User> {
  const existing = await ctx.repos.users.findById(LOCAL_LEARNER_ID);
  if (existing) return existing;
  const now = ctx.clock.nowIso();
  return ctx.repos.users.upsert({
    id: LOCAL_LEARNER_ID,
    displayName: '我',
    nativeLanguage: 'zh',
    createdAt: now,
    updatedAt: now,
  });
}

export interface CreateGoalInput {
  learnerId: string;
  /** Free text such as "我想提高英语口语". */
  text: string;
  languageCode?: string;
  makePrimary?: boolean;
  availableMinutes?: number | null;
}

export interface CreateGoalResult {
  goal: Goal;
  targets: LearningTarget[];
  /** True when an identical submission within the dedupe window was reused. */
  deduplicated: boolean;
}

/**
 * Creates a goal from natural language using deterministic rules only —
 * onboarding must work with no AI key configured (PRD §F-02).
 *
 * Also creates the initial low-confidence LearnerState per target skill: the
 * system explicitly does not pretend to know the learner yet.
 */
export async function createGoalFromText(
  ctx: AppContext,
  input: CreateGoalInput,
): Promise<CreateGoalResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw validationFailed('请描述一下你的学习目标');
  }
  if (text.length > 500) {
    throw validationFailed('目标描述太长了，请精简到 500 字以内');
  }

  await ensureLearner(ctx);

  // Double submits (double click, retried action) must not create two goals.
  const previous = await ctx.repos.goals.findLatestByRawInput(input.learnerId, text);
  const duplicate =
    previous &&
    Math.abs(Date.parse(ctx.clock.nowIso()) - Date.parse(previous.createdAt)) <=
      DUPLICATE_WINDOW_MS
      ? previous
      : null;
  if (duplicate) {
    const targets = await ctx.repos.targets.listByGoal(duplicate.id);
    return { goal: duplicate, targets, deduplicated: true };
  }

  const parsed = parseGoalInput(text);
  const languageCode = input.languageCode ?? parsed.languageCode;
  const now = ctx.clock.nowIso();

  const existingGoals = await ctx.repos.goals.listByLearner(input.learnerId, ['active']);
  const makePrimary = input.makePrimary ?? existingGoals.length === 0;
  if (makePrimary) {
    await ctx.repos.goals.clearPrimary(input.learnerId);
  }

  const goal: Goal = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    languageCode,
    title: parsed.title,
    rawInput: text,
    description: null,
    scenarios: parsed.scenarios,
    status: 'active',
    priority: makePrimary ? 1 : Math.min(5, existingGoals.length + 2),
    isPrimary: makePrimary,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.goals.create(goal);

  const targets: LearningTarget[] = parsed.skills.map((entry) => ({
    id: ctx.ids.next(),
    goalId: goal.id,
    learnerId: input.learnerId,
    skill: entry.skill,
    importance: entry.importance,
    description: null,
    status: 'active' as GoalStatus,
    createdAt: now,
    updatedAt: now,
  }));
  await ctx.repos.targets.createMany(targets);

  // Initial states: mastery 0, confidence at the floor. Nothing is assumed.
  for (const target of targets) {
    const existing = await ctx.repos.states.find(input.learnerId, 'skill', target.skill);
    if (!existing) {
      await ctx.repos.states.upsert(
        createInitialState({
          id: ctx.ids.next(),
          learnerId: input.learnerId,
          subjectType: 'skill',
          subjectId: target.skill,
          nowIso: now,
        }),
      );
    }
  }

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'goal_created',
    source: 'user',
    idempotencyKey: `goal-created:${goal.id}`,
    payload: {
      goalId: goal.id,
      languageCode,
      skills: targets.map((target) => target.skill),
      scenarios: parsed.scenarios,
      languageConfidence: parsed.languageConfidence,
    },
  });

  if (parsed.availableMinutes || input.availableMinutes) {
    await ctx.repos.preferences.upsertByKey({
      id: ctx.ids.next(),
      learnerId: input.learnerId,
      key: 'typical_session_minutes',
      value: String(input.availableMinutes ?? parsed.availableMinutes),
      confidence: 0.4,
      evidenceCount: 1,
      source: 'user_explicit',
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { goal, targets, deduplicated: false };
}

export async function listGoalsWithTargets(
  ctx: AppContext,
  learnerId: string,
): Promise<{ goal: Goal; targets: LearningTarget[] }[]> {
  const goals = await ctx.repos.goals.listByLearner(learnerId);
  const result: { goal: Goal; targets: LearningTarget[] }[] = [];
  for (const goal of goals) {
    result.push({ goal, targets: await ctx.repos.targets.listByGoal(goal.id) });
  }
  return result;
}

export interface UpdateGoalInput {
  learnerId: string;
  goalId: string;
  title?: string;
  description?: string | null;
  scenarios?: string[];
  status?: GoalStatus;
  makePrimary?: boolean;
}

export async function updateGoal(ctx: AppContext, input: UpdateGoalInput): Promise<Goal> {
  const goal = await ctx.repos.goals.findById(input.goalId);
  if (!goal || goal.learnerId !== input.learnerId) {
    throw notFound('Goal', input.goalId);
  }
  if (input.title !== undefined && input.title.trim().length === 0) {
    throw validationFailed('目标名称不能为空');
  }

  const now = ctx.clock.nowIso();
  if (input.makePrimary) {
    await ctx.repos.goals.clearPrimary(input.learnerId);
  }

  const updated: Goal = {
    ...goal,
    title: input.title?.trim() ?? goal.title,
    description: input.description === undefined ? goal.description : input.description,
    scenarios: input.scenarios ?? goal.scenarios,
    status: input.status ?? goal.status,
    isPrimary: input.makePrimary ?? (input.status === 'archived' ? false : goal.isPrimary),
    updatedAt: now,
  };
  await ctx.repos.goals.update(updated);

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'goal_updated',
    source: 'user',
    idempotencyKey: `goal-updated:${goal.id}:${now}`,
    payload: { goalId: goal.id, status: updated.status, isPrimary: updated.isPrimary },
  });

  return updated;
}

export async function getPrimaryGoal(
  ctx: AppContext,
  learnerId: string,
): Promise<{ goal: Goal; targets: LearningTarget[] } | null> {
  const goal = await ctx.repos.goals.findPrimary(learnerId);
  if (!goal) return null;
  return { goal, targets: await ctx.repos.targets.listByGoal(goal.id) };
}
