import type { Goal, LearningTarget, User } from '@/domain/entities';
import type { GoalStatus, GoalType } from '@/domain/enums';
import { notFound, validationFailed } from '@/domain/errors';
import { createInitialState } from '@/learner/state';
import { parseGoalInput } from '@/nlu/goal';
import { recordKnowledgeOperation } from './audit';
import { appendEvent } from './events';
import { ensureGoalPhases } from './phases';
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
  /** Explicit goal type; auto-detected from the text when omitted (v0.4 §G2). */
  goalType?: GoalType;
}

/** IELTS keywords, case-insensitive (v0.4 §4 迁移配套). */
const IELTS_KEYWORDS = [/雅思/i, /ielts/i];

/** Determines the goal type from the title/raw input, defaulting to `general`. */
export function detectGoalType(title: string, rawInput: string): GoalType {
  const haystack = `${title} ${rawInput}`;
  return IELTS_KEYWORDS.some((pattern) => pattern.test(haystack)) ? 'ielts' : 'general';
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
  const goalType = input.goalType ?? detectGoalType(parsed.title, text);
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
    goalType,
    createdAt: now,
    updatedAt: now,
  };
  await (makePrimary ? ctx.repos.goals.createAsPrimary(goal) : ctx.repos.goals.create(goal));

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

  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: `创建目标：${goal.title}${goal.isPrimary ? '（主攻）' : '（次要）'}`,
  });
  await ctx.repos.recommendations.expireOffered(
    input.learnerId,
    new Date(Date.parse(now) + 1).toISOString(),
  );

  // Generate phases once a starting level exists (v0.4 §G2). No-op when the
  // learner has not calibrated yet.
  await ensureGoalPhases(ctx, goal);

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
  const nextStatus = input.makePrimary ? 'active' : input.status ?? goal.status;
  const isPrimary = input.makePrimary ? true : nextStatus === 'active' ? goal.isPrimary : false;
  const updated: Goal = {
    ...goal,
    title: input.title?.trim() ?? goal.title,
    description: input.description === undefined ? goal.description : input.description,
    scenarios: input.scenarios ?? goal.scenarios,
    status: nextStatus,
    priority: isPrimary ? 1 : Math.max(2, goal.priority),
    isPrimary,
    updatedAt: now,
  };
  await (input.makePrimary
    ? ctx.repos.goals.setPrimary(updated)
    : ctx.repos.goals.update(updated));

  let promotedFallback: Goal | null = null;
  if (goal.isPrimary && !updated.isPrimary) {
    const activeGoals = await ctx.repos.goals.listByLearner(input.learnerId, ['active']);
    const fallback = activeGoals.find((candidate) => candidate.id !== goal.id);
    if (fallback) {
      promotedFallback = { ...fallback, isPrimary: true, priority: 1, updatedAt: now };
      await ctx.repos.goals.setPrimary(promotedFallback);
    }
  }

  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: input.makePrimary || promotedFallback ? 'goal_primary_changed' : 'goal_updated',
    source: 'user',
    idempotencyKey: `goal-updated:${goal.id}:${now}`,
    payload: {
      goalId: goal.id,
      status: updated.status,
      isPrimary: updated.isPrimary,
      promotedGoalId: promotedFallback?.id ?? null,
    },
  });
  await recordKnowledgeOperation(ctx, {
    learnerId: input.learnerId,
    operation: 'goal_binding_changed',
    source: 'manual',
    note: input.makePrimary
      ? `设为主攻目标：${updated.title}`
      : promotedFallback
        ? `${updated.title} 已暂停或归档，主攻目标切换为 ${promotedFallback.title}`
        : `更新目标：${updated.title}`,
  });
  await ctx.repos.recommendations.expireOffered(
    input.learnerId,
    new Date(Date.parse(now) + 1).toISOString(),
  );

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
