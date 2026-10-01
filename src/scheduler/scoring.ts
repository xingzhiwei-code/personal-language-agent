import type { Intent, SkillKind } from '@/domain/enums';
import { buildCandidates } from './candidates';
import type { Candidate, ScoredCandidate, SchedulerSnapshot } from './types';

/**
 * Deterministic scoring weights (PRD §6). Recommendations must be explainable
 * and reproducible: the same snapshot always yields the same ranking, and no
 * LLM is involved.
 */
export const SCHEDULER_WEIGHTS = {
  learningValue: 1.6,
  urgency: 1.8,
  goalAlignment: 1.2,
  contextFit: 1.0,
  durationFit: 1.5,
  preferenceFit: 0.8,
  novelty: 0.4,
  repetitionPenalty: 1.0,
  friction: 0.8,
  /** Explicit user intent dominates every learning-value consideration. */
  intentOverride: 10,
} as const;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Activity types that satisfy a declared intent. */
const INTENT_ACTIVITIES: Record<Intent, readonly string[]> = {
  conversation: ['conversation'],
  practice: ['quick_review', 'vocabulary_recall', 'grammar_practice', 'writing'],
  learning: ['reading', 'quick_review', 'vocabulary_recall'],
  exploration: ['reading'],
  support: [],
  unknown: [],
};

function skillImportance(snapshot: SchedulerSnapshot, skill: SkillKind): number {
  const target = snapshot.targets.find((entry) => entry.skill === skill);
  return target ? target.importance : 0.25;
}

function skillMastery(snapshot: SchedulerSnapshot, skill: SkillKind): { mastery: number; confidence: number } {
  const state = snapshot.skillStates.find((entry) => entry.subjectId === skill);
  return { mastery: state?.mastery ?? 0, confidence: state?.confidence ?? 0 };
}

/** Weakness × goal importance: where practice buys the most real capability. */
function learningValue(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  if (candidate.skills.length === 0) return 0.3;
  let total = 0;
  for (const skill of candidate.skills) {
    const importance = skillImportance(snapshot, skill);
    const { mastery, confidence } = skillMastery(snapshot, skill);
    const weakness = 1 - mastery;
    // Low confidence also has value: measuring is itself informative.
    const informationGain = 1 - confidence;
    total += importance * (weakness * 0.75 + informationGain * 0.25);
  }
  return clamp01(total / candidate.skills.length);
}

function urgency(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  if (candidate.activityType === 'quick_review') {
    const due = snapshot.dueReviews.length;
    if (due === 0) return 0;
    const maxOverdue = snapshot.dueReviews.reduce(
      (max, review) => Math.max(max, review.overdueDays),
      0,
    );
    const volume = clamp01(due / 12);
    const lateness = clamp01(maxOverdue / 7);
    return clamp01(0.45 + volume * 0.3 + lateness * 0.25);
  }
  if (candidate.activityType === 'vocabulary_recall') {
    return clamp01(snapshot.dueReviews.length / 20);
  }
  return 0.15;
}

function goalAlignment(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  if (!snapshot.goal) return 0.3;
  if (candidate.skills.length === 0) return 0.3;
  const best = Math.max(...candidate.skills.map((skill) => skillImportance(snapshot, skill)));
  const priorityBoost = clamp01((6 - snapshot.goal.priority) / 5);
  return clamp01(best * 0.8 + priorityBoost * 0.2);
}

function contextFit(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  const context = snapshot.context;
  if (!context) return 0.7;
  let fit = 0.7;

  if (candidate.activityType === 'conversation') {
    fit = context.canType || context.canSpeak ? 0.9 : 0.2;
    if (context.attention === 'low') fit -= 0.3;
  } else if (candidate.activityType === 'writing') {
    fit = context.canType ? 0.85 : 0.1;
    if (context.attention === 'low') fit -= 0.35;
  } else if (candidate.activityType === 'reading') {
    fit = context.canRead ? 0.85 : 0.1;
  } else {
    fit = context.canRead ? 0.9 : 0.4;
    if (context.attention === 'low') fit += 0.05; // short drills survive low focus
  }

  if (context.device === 'mobile' && candidate.activityType === 'writing') fit -= 0.2;
  return clamp01(fit);
}

/**
 * Hard rule: a 3-minute window must never be filled with a 15-minute task.
 * Returns null when the candidate is infeasible for the available time.
 */
function durationFit(
  snapshot: SchedulerSnapshot,
  candidate: Candidate,
): { fit: number; plannedMinutes: number } | null {
  const available = snapshot.context?.availableMinutes ?? null;
  if (available === null) {
    return { fit: 0.8, plannedMinutes: candidate.preferredMinutes };
  }
  if (available < candidate.minMinutes) return null;

  const planned = Math.max(
    candidate.minMinutes,
    Math.min(candidate.preferredMinutes, available),
  );
  // Perfect fit when we use most of the window without exceeding it.
  const utilisation = planned / available;
  const fit = utilisation >= 0.6 ? 1 : 0.6 + utilisation * 0.4;
  return { fit: clamp01(fit), plannedMinutes: planned };
}

function preferenceFit(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  const liked = snapshot.preferences.find(
    (preference) => preference.key === `likes_activity:${candidate.activityType}`,
  );
  const disliked = snapshot.preferences.find(
    (preference) => preference.key === `dislikes_activity:${candidate.activityType}`,
  );
  let fit = 0.5;
  if (liked) fit += 0.5 * liked.confidence;
  if (disliked) fit -= 0.6 * disliked.confidence;
  return clamp01(fit);
}

function novelty(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  const index = snapshot.recentActivityTypes.indexOf(candidate.activityType);
  if (index === -1) return 1;
  return clamp01(index / Math.max(1, snapshot.recentActivityTypes.length));
}

function repetitionPenalty(snapshot: SchedulerSnapshot, candidate: Candidate): number {
  const recent = snapshot.recentActivityTypes.slice(0, 3);
  const occurrences = recent.filter((type) => type === candidate.activityType).length;
  let penalty = clamp01(occurrences / 3);
  // A rejection right now matters for this recommendation only; it never
  // becomes a permanent preference (PRD §F-01).
  if (snapshot.rejectedActivityTypes.includes(candidate.activityType)) penalty += 1;
  return penalty;
}

function buildReason(
  snapshot: SchedulerSnapshot,
  candidate: Candidate,
  plannedMinutes: number,
  intentMatched: boolean,
): string {
  if (intentMatched) {
    return `按你现在说的来安排，约 ${plannedMinutes} 分钟`;
  }

  const parts: string[] = [];
  if (candidate.activityType === 'quick_review' && snapshot.dueReviews.length > 0) {
    parts.push(`${snapshot.dueReviews.length} 条内容到了复习时间`);
  } else {
    const weakest = candidate.skills
      .map((skill) => ({ skill, ...skillMastery(snapshot, skill) }))
      .sort((a, b) => a.mastery - b.mastery)[0];
    if (weakest && weakest.confidence < 0.3) {
      parts.push(`关于你的${SKILL_TEXT[weakest.skill]}我们还没什么数据，做一次能让判断更准`);
    } else if (weakest) {
      parts.push(`${SKILL_TEXT[weakest.skill]}目前相对薄弱`);
    }
  }
  if (parts.length === 0 && candidate.reasonHints[0]) {
    parts.push(candidate.reasonHints[0]);
  }
  parts.push(`约 ${plannedMinutes} 分钟`);
  return parts.join('，');
}

const SKILL_TEXT: Record<SkillKind, string> = {
  speaking: '口语',
  listening: '听力',
  reading: '阅读',
  writing: '写作',
  vocabulary: '词汇',
  grammar: '语法',
  pronunciation: '发音',
  interaction: '互动交流',
};

export function scoreCandidates(snapshot: SchedulerSnapshot): ScoredCandidate[] {
  const declaredIntent = snapshot.context?.intent ?? 'unknown';
  const intentTargets = INTENT_ACTIVITIES[declaredIntent] ?? [];

  const scored: ScoredCandidate[] = [];
  for (const candidate of buildCandidates(snapshot)) {
    const duration = durationFit(snapshot, candidate);
    if (!duration) continue; // does not fit the available time at all

    const factors = {
      learningValue: round3(learningValue(snapshot, candidate)),
      urgency: round3(urgency(snapshot, candidate)),
      goalAlignment: round3(goalAlignment(snapshot, candidate)),
      contextFit: round3(contextFit(snapshot, candidate)),
      durationFit: round3(duration.fit),
      preferenceFit: round3(preferenceFit(snapshot, candidate)),
      novelty: round3(novelty(snapshot, candidate)),
      repetitionPenalty: round3(repetitionPenalty(snapshot, candidate)),
      friction: round3(candidate.friction),
    };

    const intentMatched = intentTargets.includes(candidate.activityType);
    const base =
      factors.learningValue * SCHEDULER_WEIGHTS.learningValue +
      factors.urgency * SCHEDULER_WEIGHTS.urgency +
      factors.goalAlignment * SCHEDULER_WEIGHTS.goalAlignment +
      factors.contextFit * SCHEDULER_WEIGHTS.contextFit +
      factors.durationFit * SCHEDULER_WEIGHTS.durationFit +
      factors.preferenceFit * SCHEDULER_WEIGHTS.preferenceFit +
      factors.novelty * SCHEDULER_WEIGHTS.novelty -
      factors.repetitionPenalty * SCHEDULER_WEIGHTS.repetitionPenalty -
      factors.friction * SCHEDULER_WEIGHTS.friction;

    const score = round3(base + (intentMatched ? SCHEDULER_WEIGHTS.intentOverride : 0));
    const estimatedItemCount = Math.max(
      0,
      Math.min(
        candidate.maxItems,
        Math.round(duration.plannedMinutes * candidate.itemsPerMinute),
      ),
    );

    scored.push({
      activityType: candidate.activityType,
      score,
      factors,
      plannedDurationMinutes: duration.plannedMinutes,
      estimatedItemCount,
      subjectIds: candidate.subjectIds.slice(0, Math.max(estimatedItemCount, 1) * 2),
      requiresAi: candidate.requiresAi,
      reason: buildReason(snapshot, candidate, duration.plannedMinutes, intentMatched),
    });
  }

  return scored.sort((a, b) =>
    b.score === a.score ? a.activityType.localeCompare(b.activityType) : b.score - a.score,
  );
}
