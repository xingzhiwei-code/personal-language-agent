import type { KnowledgeItem, Placement, PlacementSkill } from '@/domain/entities';
import type { ActivityKind, PlacementConfidence, PlacementType } from '@/domain/enums';
import type { ReviewItemSpec } from '@/assessment/review-items';
import { appendEvent } from './events';
import { ensureAllGoalPhases } from './phases';
import type { AppContext } from './types';

/**
 * v0.4 §G1 — level placement (起点校准).
 *
 * Honest scope: the placement measures four dimensions we *can* measure
 * (vocabulary / spelling / listening / written expression). It never claims to
 * measure "听说读写" (no reading-passage or speaking assessment exists).
 * It is measurement, not learning: a placement session never writes mastery
 * (see sessions.ts) and never counts toward the streak (see streak.ts).
 *
 * The output is a rough band on an internal 0–9 scale aligned to IELTS bands.
 * The mapping is deterministic and transparently documented here; it is a
 * coarse estimate, not a calibrated test score (宪法#8 — it is a hypothesis).
 */

/** Questions per measurable dimension (PRD: 3–5 each). */
export const PLACEMENT_QUESTIONS_PER_DIMENSION = 4;

/** Self-report options → rough band. `unsure` carries no band. */
export const SELF_REPORT_OPTIONS = [
  { value: 'below_cet4', label: '低于4级', level: 3.5 },
  { value: 'cet4', label: '4级水平', level: 4.0 },
  { value: 'cet6', label: '6级水平', level: 6.0 },
  { value: 'ielts5', label: '雅思5分左右', level: 5.0 },
  { value: 'ielts6', label: '雅思6分左右', level: 6.0 },
  { value: 'unsure', label: '不确定', level: null },
] as const;

export type SelfReportValue = (typeof SELF_REPORT_OPTIONS)[number]['value'];

export function selfReportLevel(value: SelfReportValue): number | null {
  return SELF_REPORT_OPTIONS.find((option) => option.value === value)?.level ?? null;
}

/** Test and self-report conflict when they differ by more than this many bands. */
export const PLACEMENT_CONFLICT_THRESHOLD = 1.5;

export interface PlacementSynthesis {
  /** Final band, or null when the sources conflict and need the user to decide. */
  level: number | null;
  confidence: PlacementConfidence;
  evidence: Placement['evidence'];
  /** True when test and self-report disagree enough to require confirmation. */
  conflict: boolean;
  testLevel: number | null;
  selfLevel: number | null;
}

/**
 * Deterministic synthesis of the two signals (v0.4 §G1):
 *  - test present: test wins; self-report is only a cross-check.
 *  - test + self differ by >1.5 bands: conflict — the user must decide.
 *  - no test: self-report with confidence `low`.
 */
export function synthesizePlacement(
  testLevel: number | null,
  selfLevel: number | null,
): PlacementSynthesis {
  if (testLevel !== null && selfLevel !== null) {
    if (Math.abs(testLevel - selfLevel) > PLACEMENT_CONFLICT_THRESHOLD) {
      return {
        level: null,
        confidence: 'low',
        evidence: [],
        conflict: true,
        testLevel,
        selfLevel,
      };
    }
    return {
      level: testLevel,
      confidence: 'medium',
      evidence: ['test', 'self_report'],
      conflict: false,
      testLevel,
      selfLevel,
    };
  }
  if (testLevel !== null) {
    return {
      level: testLevel,
      confidence: 'medium',
      evidence: ['test'],
      conflict: false,
      testLevel,
      selfLevel: null,
    };
  }
  if (selfLevel !== null) {
    return {
      level: selfLevel,
      confidence: 'low',
      evidence: ['self_report'],
      conflict: false,
      testLevel: null,
      selfLevel,
    };
  }
  return {
    level: null,
    confidence: 'low',
    evidence: [],
    conflict: false,
    testLevel: null,
    selfLevel: null,
  };
}

/** Maps a 0..1 correctness ratio to a 0–9 band (half-band steps, 1..9). */
export function scoreToBand(score: number): number {
  const clamped = Math.max(0, Math.min(1, score));
  return roundHalf(1 + clamped * 8);
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export interface PlacementView {
  placement: Placement | null;
  /** Synthesis of the latest test + self-report rows (may be in conflict). */
  synthesis: PlacementSynthesis;
}

/** Latest placement plus the deterministic synthesis of the two signals. */
export async function getPlacementView(
  ctx: AppContext,
  learnerId: string,
): Promise<PlacementView> {
  const rows = await ctx.repos.placements.listByLearner(learnerId, 20);
  const latest = rows[0] ?? null;
  const test = rows.find((row) => row.type === 'test' && row.evidence.includes('test'));
  const self = rows.find((row) => row.type === 'self_report');
  const synthesis = synthesizePlacement(
    test?.overallLevel ?? null,
    self?.overallLevel ?? null,
  );
  return { placement: latest, synthesis };
}

export interface RecordPlacementInput {
  learnerId: string;
  type: PlacementType;
  skills: PlacementSkill;
  overallLevel: number;
  confidence: PlacementConfidence;
  evidence: Placement['evidence'];
  /** Stable idempotency key; a duplicate returns null instead of a new row. */
  idempotencyKey: string;
  /** Optional session link for test placements (traceability). */
  sessionId?: string | null;
}

/** Writes one placement row plus a `placement_completed` event. Idempotent. */
export async function recordPlacement(
  ctx: AppContext,
  input: RecordPlacementInput,
): Promise<Placement | null> {
  const existing = await ctx.repos.events.findByIdempotencyKey(input.learnerId, input.idempotencyKey);
  if (existing) return null;

  const now = ctx.clock.nowIso();
  const placement: Placement = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    type: input.type,
    skills: input.skills,
    overallLevel: input.overallLevel,
    confidence: input.confidence,
    evidence: input.evidence,
    createdAt: now,
  };
  await ctx.repos.placements.create(placement);
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'placement_completed',
    source: 'user',
    sessionId: input.sessionId ?? null,
    idempotencyKey: input.idempotencyKey,
    payload: {
      type: input.type,
      overallLevel: input.overallLevel,
      confidence: input.confidence,
    },
  });

  // A starting level now exists — generate phases for any goal that lacks them.
  await ensureAllGoalPhases(ctx, input.learnerId);
  return placement;
}

/** Records a self-report placement (no test), confidence `low`. */
export async function recordSelfReportPlacement(
  ctx: AppContext,
  learnerId: string,
  value: SelfReportValue,
  note?: string | null,
): Promise<Placement | null> {
  const level = selfReportLevel(value);
  if (level === null) return null;
  return recordPlacement(ctx, {
    learnerId,
    type: 'self_report',
    skills: { vocabulary: null, spelling: null, listening: null, writtenExpression: null },
    overallLevel: level,
    confidence: 'low',
    evidence: ['self_report'],
    idempotencyKey: `placement:self-report:${value}:${note?.trim().slice(0, 40) ?? ''}`,
  });
}

/** Manual override of the final starting level (宪法#2 — the user decides). */
export async function recordPlacementOverride(
  ctx: AppContext,
  learnerId: string,
  overallLevel: number,
): Promise<Placement | null> {
  const clamped = Math.max(0, Math.min(9, overallLevel));
  return recordPlacement(ctx, {
    learnerId,
    type: 'override',
    skills: { vocabulary: null, spelling: null, listening: null, writtenExpression: null },
    overallLevel: clamped,
    confidence: 'high',
    evidence: ['override'],
    idempotencyKey: `placement:override:${ctx.clock.nowIso()}`,
  });
}

/**
 * Builds the placement session's question set. Reuses the existing card kinds
 * (recognition / recall / dictation / writing) but forces one fixed modality
 * per dimension, independent of any learner state, so the test measures the
 * same four dimensions for everyone. Word selection is difficulty-graded
 * (frequencyRank) and deterministic.
 */
export async function buildPlacementSpecs(
  ctx: AppContext,
  learnerId: string,
): Promise<ReviewItemSpec[]> {
  const items = await ctx.repos.knowledge.search({
    learnerId,
    statuses: ['active'],
    types: ['word', 'phrase', 'chunk', 'expression'],
    limit: 400,
  });
  const withMeaning = items.filter((item) => (item.meaning?.trim().length ?? 0) > 0);
  if (withMeaning.length === 0) return [];

  const per = PLACEMENT_QUESTIONS_PER_DIMENSION;
  const pool = spreadByDifficulty(withMeaning, per * 4);
  const meanings = withMeaning.map((item) => item.meaning!.trim());
  const specs: ReviewItemSpec[] = [];

  // 1) Vocabulary — recognition MCQ.
  for (const item of pool.slice(0, per)) {
    const meaning = item.meaning!.trim();
    const distractors = meanings.filter((candidate) => candidate !== meaning).slice(0, 3);
    specs.push({
      kind: 'review_recognition',
      modality: 'recognition',
      subjectId: item.id,
      prompt: `「${item.text}」的意思是？`,
      options: [meaning, ...distractors],
      expectedAnswer: meaning,
      hint: null,
    });
  }

  // 2) Spelling — recall (produce the target form from its meaning).
  for (const item of pool.slice(per, per * 2)) {
    const meaning = item.meaning!.trim();
    specs.push({
      kind: 'review_recall',
      modality: 'recall',
      subjectId: item.id,
      prompt: `「${meaning}」用英语怎么表达？`,
      options: null,
      expectedAnswer: item.text,
      hint: item.text.length > 2 ? `${item.text.slice(0, 1)}…` : null,
    });
  }

  // 3) Listening — dictation (single words only; others fall back naturally).
  const dictationPool = pool.filter((item) => item.text.trim().split(/\s+/).length === 1);
  for (const item of dictationPool.slice(0, per)) {
    const meaning = item.meaning!.trim();
    const distractors = meanings.filter((candidate) => candidate !== meaning).slice(0, 3);
    specs.push({
      kind: 'review_dictation',
      modality: 'recognition',
      subjectId: item.id,
      prompt: '听写你听到的单词',
      options: [meaning, ...distractors],
      expectedAnswer: item.text,
      hint: meaning,
    });
  }

  // 4) Written expression — write a self-related sentence using the expression.
  for (const item of pool.slice(per * 2, per * 3)) {
    specs.push({
      kind: 'writing_prompt',
      modality: 'production',
      subjectId: item.id,
      prompt: `用「${item.text}」写一个跟你自己相关的句子`,
      options: null,
      expectedAnswer: item.text,
      hint: item.meaning?.trim() ?? null,
    });
  }

  return specs;
}

/** Activity kind → placement dimension (v0.4 §G1 四科). */
const DIMENSION_BY_KIND: Partial<Record<ActivityKind, keyof PlacementSkill>> = {
  review_recognition: 'vocabulary',
  review_recall: 'spelling',
  review_dictation: 'listening',
  writing_prompt: 'writtenExpression',
};

/**
 * Finalises a placement session: aggregates the four dimensions' answers into
 * band estimates and records a `test` placement. Idempotent on the session.
 */
export async function finalizePlacementFromSession(
  ctx: AppContext,
  learnerId: string,
  sessionId: string,
): Promise<Placement | null> {
  const [activities, assessments] = await Promise.all([
    ctx.repos.activities.listBySession(sessionId),
    ctx.repos.assessments.listBySession(sessionId),
  ]);
  if (assessments.length === 0) return null;

  const kindByActivity = new Map(activities.map((activity) => [activity.id, activity.kind]));
  const scoresByDimension = new Map<keyof PlacementSkill, number[]>();
  for (const assessment of assessments) {
    const kind = kindByActivity.get(assessment.activityId ?? '');
    if (!kind) continue;
    const dimension = DIMENSION_BY_KIND[kind];
    if (!dimension) continue;
    const bucket = scoresByDimension.get(dimension) ?? [];
    bucket.push(assessment.score);
    scoresByDimension.set(dimension, bucket);
  }

  const skills: PlacementSkill = {
    vocabulary: null,
    spelling: null,
    listening: null,
    writtenExpression: null,
  };
  const bands: number[] = [];
  for (const dimension of ['vocabulary', 'spelling', 'listening', 'writtenExpression'] as const) {
    const scores = scoresByDimension.get(dimension) ?? [];
    if (scores.length === 0) continue;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const band = scoreToBand(average);
    skills[dimension] = band;
    bands.push(band);
  }
  if (bands.length === 0) return null;
  const overallLevel = roundHalf(bands.reduce((sum, band) => sum + band, 0) / bands.length);

  return recordPlacement(ctx, {
    learnerId,
    type: 'test',
    skills,
    overallLevel,
    confidence: 'medium',
    evidence: ['test'],
    idempotencyKey: `placement:test:${sessionId}`,
    sessionId,
  });
}

/** Deterministic difficulty spread: keep low/high frequency, neutral in between. */
function spreadByDifficulty(items: KnowledgeItem[], count: number): KnowledgeItem[] {
  const sorted = [...items].sort(
    (a, b) =>
      (a.frequencyRank ?? 0.5) - (b.frequencyRank ?? 0.5) || a.id.localeCompare(b.id),
  );
  if (sorted.length <= count) return sorted;
  const step = (sorted.length - 1) / (count - 1);
  const picked: KnowledgeItem[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round(i * step);
    if (!seen.has(index)) {
      seen.add(index);
      picked.push(sorted[index]!);
    }
  }
  // Backfill any shortfall with the earliest unused items.
  for (const item of sorted) {
    if (picked.length >= count) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}
