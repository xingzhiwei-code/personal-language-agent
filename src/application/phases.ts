import type { Goal, GoalPhase } from '@/domain/entities';
import type { GoalType, PhaseStatus } from '@/domain/enums';
import { notFound, validationFailed } from '@/domain/errors';
import { appendEvent } from './events';
import type { AppContext } from './types';

/**
 * v0.4 §G2 — goal phases (Goal → Phase → Daily).
 *
 * A phase is a property of the GOAL (not the learner). It is generated from a
 * template selected by `goal.goalType`, and its first phase becomes active once
 * a starting level (placement) exists.
 *
 * Exit criteria are deterministic and honestly scoped: v0.4 can compute
 * `phase_word_mastery` (average mastery of the goal's bound words) and
 * `placement_retest` (a re-taken placement test). Every other criterion
 * (skill quizzes, writing-topic accuracy, mock tests) has no measurable data
 * source yet and is therefore reported as "unmeasured", never fabricated
 * (宪法#8 / red line "缺数据不编造"). A phase with any unmeasured criterion
 * can still be advanced by an explicit user override (宪法#2).
 */

// ---------------------------------------------------------------------------
// Templates (集中配置)
// ---------------------------------------------------------------------------

export interface ExitCriterion {
  metric: string;
  threshold: number | null;
  label: string;
}

export interface PhaseSpec {
  seq: number;
  name: string;
  description: string;
  topicSequence: string[];
  exitCriteria: ExitCriterion[];
}

/** Metrics v0.4 can actually compute. Everything else is honestly unmeasured. */
export const COMPUTABLE_METRICS = new Set(['phase_word_mastery', 'placement_retest']);

const WORD_MASTERY_80: ExitCriterion = {
  metric: 'phase_word_mastery',
  threshold: 0.8,
  label: '阶段词掌握度 ≥80%',
};
const WORD_MASTERY_75: ExitCriterion = {
  metric: 'phase_word_mastery',
  threshold: 0.75,
  label: '话题词掌握度 ≥75%',
};
const PLACEMENT_RETEST_4: ExitCriterion = {
  metric: 'placement_retest',
  threshold: 4.0,
  label: '摸底复测 ≥4级水平',
};

export const PHASE_TEMPLATES: Record<GoalType, PhaseSpec[]> = {
  ielts: [
    {
      seq: 1,
      name: '基础重建',
      description: '四级核心词与基础语法打底',
      topicSequence: ['daily_life', 'education', 'work'],
      exitCriteria: [WORD_MASTERY_80, PLACEMENT_RETEST_4],
    },
    {
      seq: 2,
      name: '5.5~6 分段',
      description: '学术话题词入门，四科能力起步',
      topicSequence: ['education', 'technology', 'environment', 'health'],
      exitCriteria: [
        WORD_MASTERY_75,
        { metric: 'skill_quiz', threshold: 0.6, label: '各科小测正确率 ≥60%' },
      ],
    },
    {
      seq: 3,
      name: '6.5 分段',
      description: '高频学术搭配/长难句，写作 Task 2 分话题推进',
      topicSequence: ['work', 'culture', 'science', 'society'],
      exitCriteria: [
        { metric: 'writing_topic_accuracy', threshold: 0.7, label: '写作分话题正确率 ≥70%' },
        { metric: 'skill_quiz', threshold: 0.65, label: '听力/阅读小测 ≥65%' },
      ],
    },
    {
      seq: 4,
      name: '7 分冲刺',
      description: '模考节奏训练，查漏补缺',
      topicSequence: ['travel', 'environment', 'health', 'society'],
      exitCriteria: [
        { metric: 'mock_test', threshold: 6.5, label: '完整模考 ≥6.5' },
        { metric: 'weakness_retest', threshold: null, label: '薄弱项回测达标' },
      ],
    },
  ],
  general: [
    {
      seq: 1,
      name: '基础',
      description: '常用表达打底',
      topicSequence: ['daily_life', 'education', 'work'],
      exitCriteria: [WORD_MASTERY_80],
    },
    {
      seq: 2,
      name: '进阶',
      description: '扩展话题词汇与表达',
      topicSequence: ['technology', 'environment', 'health', 'culture'],
      exitCriteria: [WORD_MASTERY_80],
    },
    {
      seq: 3,
      name: '运用',
      description: '把表达用到真实场景',
      topicSequence: ['work', 'science', 'society', 'travel'],
      exitCriteria: [WORD_MASTERY_80],
    },
  ],
};

// ---------------------------------------------------------------------------
// Phase generation
// ---------------------------------------------------------------------------

/**
 * Generates phases for a goal if it has none, using its goal type and the
 * learner's latest starting level. Idempotent. Returns the existing phases when
 * already present, or an empty array when no starting level exists yet.
 */
export async function ensureGoalPhases(
  ctx: AppContext,
  goal: Goal,
): Promise<GoalPhase[]> {
  const existing = await ctx.repos.goalPhases.listByGoal(goal.id);
  if (existing.length > 0) return existing;

  const placement = await ctx.repos.placements.findLatest(goal.learnerId);
  if (!placement) return [];

  const specs = PHASE_TEMPLATES[goal.goalType] ?? PHASE_TEMPLATES.general;
  const now = ctx.clock.nowIso();
  const phases: GoalPhase[] = specs.map((spec, index) => ({
    id: ctx.ids.next(),
    goalId: goal.id,
    seq: spec.seq,
    name: spec.name,
    description: spec.description,
    topicSequence: spec.topicSequence,
    entryCriteria: { startingLevel: placement.overallLevel },
    exitCriteria: { items: spec.exitCriteria },
    status: (index === 0 ? 'active' : 'locked') as PhaseStatus,
    progressCache: {},
    createdAt: now,
    updatedAt: now,
  }));
  await ctx.repos.goalPhases.createMany(phases);

  await appendEvent(ctx, {
    learnerId: goal.learnerId,
    type: 'phase_started',
    source: 'system',
    idempotencyKey: `phase-started:${phases[0]!.id}`,
    payload: { phaseId: phases[0]!.id, seq: phases[0]!.seq, goalId: goal.id },
  });
  return phases;
}

/** Generates phases for every active goal that still lacks them. */
export async function ensureAllGoalPhases(ctx: AppContext, learnerId: string): Promise<void> {
  const goals = await ctx.repos.goals.listByLearner(learnerId, ['active']);
  for (const goal of goals) {
    await ensureGoalPhases(ctx, goal);
  }
}

export async function listGoalPhases(ctx: AppContext, goalId: string): Promise<GoalPhase[]> {
  return ctx.repos.goalPhases.listByGoal(goalId);
}

export async function getActivePhase(ctx: AppContext, goalId: string): Promise<GoalPhase | null> {
  return ctx.repos.goalPhases.findActiveByGoal(goalId);
}

// ---------------------------------------------------------------------------
// Exit-criteria progress (deterministic, honest)
// ---------------------------------------------------------------------------

export interface PhaseProgressItem {
  metric: string;
  label: string;
  threshold: number | null;
  /** Current value (0..1 for mastery, band for placement), null when unmeasured. */
  current: number | null;
  met: boolean;
  /** False for criteria v0.4 has no data source for — never fabricated. */
  measured: boolean;
}

export interface PhaseProgress {
  items: PhaseProgressItem[];
  /** True when every criterion is both measured and met. */
  exitMet: boolean;
}

/** Average mastery over the goal's bound wordlist words (0..1). */
export async function computePhaseWordMastery(
  ctx: AppContext,
  learnerId: string,
  goalId: string,
): Promise<number> {
  const wordlists = await ctx.repos.wordlists.listByLearner(learnerId);
  const boundIds = wordlists.filter((wordlist) => wordlist.goalId === goalId).map((wordlist) => wordlist.id);
  if (boundIds.length === 0) return 0;
  const items = await ctx.repos.knowledge.search({
    learnerId,
    wordlistIds: boundIds,
    statuses: ['active', 'user_mastered'],
    limit: 20_000,
  });
  if (items.length === 0) return 0;
  const states = await ctx.repos.states.listBySubjectIds(
    learnerId,
    'knowledge_item',
    items.map((item) => item.id),
  );
  const masteryById = new Map(states.map((state) => [state.subjectId, state.mastery]));
  const total = items.reduce((sum, item) => sum + (masteryById.get(item.id) ?? 0), 0);
  return round(total / items.length);
}

export async function computePhaseProgress(
  ctx: AppContext,
  learnerId: string,
  goalId: string,
  phase: GoalPhase,
): Promise<PhaseProgress> {
  const criteria = (phase.exitCriteria as { items?: ExitCriterion[] }).items ?? [];
  const items: PhaseProgressItem[] = [];
  for (const criterion of criteria) {
    if (criterion.metric === 'phase_word_mastery') {
      const current = await computePhaseWordMastery(ctx, learnerId, goalId);
      const met = current >= (criterion.threshold ?? 0.8);
      items.push({ ...criterion, current, met, measured: true });
    } else if (criterion.metric === 'placement_retest') {
      const placement = await ctx.repos.placements.findLatest(learnerId);
      const current = placement && placement.type === 'test' ? placement.overallLevel : null;
      const met = current !== null && current >= (criterion.threshold ?? 4.0);
      items.push({ ...criterion, current, met, measured: current !== null });
    } else {
      // No data source in v0.4 — report honestly as unmeasured, never fake a 0.
      items.push({ ...criterion, current: null, met: false, measured: false });
    }
  }
  const exitMet = items.length > 0 && items.every((item) => item.measured && item.met);
  return { items, exitMet };
}

// ---------------------------------------------------------------------------
// Phase transitions (system suggests, the user confirms — 宪法#2)
// ---------------------------------------------------------------------------

export type PhaseTransitionMode = 'auto' | 'skip' | 'rollback';

async function transitionPhase(
  ctx: AppContext,
  learnerId: string,
  goalId: string,
  targetSeq: number,
  mode: PhaseTransitionMode,
): Promise<GoalPhase> {
  const phases = await ctx.repos.goalPhases.listByGoal(goalId);
  if (phases.length === 0) throw validationFailed('这个目标还没有阶段，先校准起点');
  const active = phases.find((phase) => phase.status === 'active');
  if (!active) throw validationFailed('当前没有进行中的阶段');
  const target = phases.find((phase) => phase.seq === targetSeq);
  if (!target) throw validationFailed('目标阶段不存在');

  const now = ctx.clock.nowIso();

  // Deactivate the current active phase.
  const activeNext: GoalPhase = {
    ...active,
    status: mode === 'rollback' ? 'locked' : 'done',
    updatedAt: now,
  };
  await ctx.repos.goalPhases.update(activeNext);

  // Activate the target phase.
  const targetNext: GoalPhase = { ...target, status: 'active', updatedAt: now };
  await ctx.repos.goalPhases.update(targetNext);

  // Honest events: auto = phase_completed/phase_started; manual = phase_override.
  if (mode === 'auto') {
    await appendEvent(ctx, {
      learnerId,
      type: 'phase_completed',
      source: 'user',
      idempotencyKey: `phase-completed:${active.id}:${now}`,
      payload: { phaseId: active.id, seq: active.seq, goalId },
    });
    await appendEvent(ctx, {
      learnerId,
      type: 'phase_started',
      source: 'user',
      idempotencyKey: `phase-started:${target.id}:${now}`,
      payload: { phaseId: target.id, seq: target.seq, goalId },
    });
  } else {
    await appendEvent(ctx, {
      learnerId,
      type: 'phase_override',
      source: 'user',
      idempotencyKey: `phase-override:${active.id}:${target.id}:${now}`,
      payload: {
        goalId,
        fromSeq: active.seq,
        toSeq: target.seq,
        direction: mode === 'skip' ? 'forward' : 'backward',
      },
    });
  }
  return targetNext;
}

/** User confirms the suggested move to the next phase (exit criteria met). */
export async function advancePhase(
  ctx: AppContext,
  learnerId: string,
  goalId: string,
): Promise<GoalPhase> {
  const active = await ctx.repos.goalPhases.findActiveByGoal(goalId);
  if (!active) throw notFound('GoalPhase', goalId);
  // The UI gates this on exit criteria; the server re-verifies so a direct call
  // cannot silently "complete" a phase that is not actually met (honest events).
  const progress = await computePhaseProgress(ctx, learnerId, goalId, active);
  if (!progress.exitMet) {
    throw validationFailed('尚未达到准出标准；如需推进请手动跳过本阶段');
  }
  return transitionPhase(ctx, learnerId, goalId, active.seq + 1, 'auto');
}

/** Manual skip forward (二次确认 handled by the UI). */
export async function skipPhase(
  ctx: AppContext,
  learnerId: string,
  goalId: string,
): Promise<GoalPhase> {
  const active = await ctx.repos.goalPhases.findActiveByGoal(goalId);
  if (!active) throw notFound('GoalPhase', goalId);
  const phases = await ctx.repos.goalPhases.listByGoal(goalId);
  if (!phases.some((phase) => phase.seq === active.seq + 1)) {
    throw validationFailed('已经是最后一个阶段，无法跳过');
  }
  return transitionPhase(ctx, learnerId, goalId, active.seq + 1, 'skip');
}

/** Manual rollback to the previous phase (二次确认 handled by the UI). */
export async function rollbackPhase(
  ctx: AppContext,
  learnerId: string,
  goalId: string,
): Promise<GoalPhase> {
  const active = await ctx.repos.goalPhases.findActiveByGoal(goalId);
  if (!active) throw notFound('GoalPhase', goalId);
  if (active.seq <= 1) throw validationFailed('已经是第一个阶段，无法回退');
  return transitionPhase(ctx, learnerId, goalId, active.seq - 1, 'rollback');
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
