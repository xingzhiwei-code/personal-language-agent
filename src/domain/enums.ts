import { z } from 'zod';

/**
 * Domain enums. Pure TypeScript + zod only.
 * No framework, ORM, vendor SDK or browser API may be imported here.
 */

/** Language is NOT hardcoded to English in the domain. */
export const languageCodeSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[A-Za-z0-9]{2,4})?$/, 'Expected a BCP-47-like code such as "en" or "ja"');
export type LanguageCode = z.infer<typeof languageCodeSchema>;

export const skillKindSchema = z.enum([
  'listening',
  'speaking',
  'reading',
  'writing',
  'vocabulary',
  'grammar',
  'pronunciation',
  'interaction',
]);
export type SkillKind = z.infer<typeof skillKindSchema>;

export const goalStatusSchema = z.enum(['active', 'paused', 'archived']);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

export const knowledgeTypeSchema = z.enum([
  'word',
  'phrase',
  'chunk',
  'sentence',
  'pattern',
  'grammar',
  'pronunciation',
  'expression',
  'concept',
]);
export type KnowledgeType = z.infer<typeof knowledgeTypeSchema>;

export const knowledgeRelationTypeSchema = z.enum([
  'related',
  'derived_from',
  'variant_of',
  'contrasts_with',
  'commonly_used_with',
  'part_of',
  'example_of',
]);
export type KnowledgeRelationType = z.infer<typeof knowledgeRelationTypeSchema>;

/**
 * Knowledge lifecycle (v0.2 §F6).
 *
 * `new`      — in the import pool: stored but deliberately NOT in the SRS due
 *              queue. Nothing is scheduled until the learner (or the daily
 *              budget) promotes it.
 * `active`   — in study: eligible for review scheduling and recommendations.
 * `user_mastered` — the learner declared it known; leaves daily rotation.
 * `irrelevant`    — wrong detection / not wanted; never scheduled.
 * `archived`      — soft-removed.
 *
 * The pool/study split is what stops an import of 4000 words from dumping 4000
 * items into tomorrow's review queue.
 */
export const knowledgeStatusSchema = z.enum([
  'new',
  'active',
  'user_mastered',
  'irrelevant',
  'archived',
]);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

/** Statuses that may enter the SRS queue and recommendation candidates. */
export const SCHEDULABLE_KNOWLEDGE_STATUSES = ['active'] as const satisfies readonly KnowledgeStatus[];

/**
 * Provenance of language material. AI-generated content must never be
 * presented as authentic material (PRD §8).
 */
export const contentOriginSchema = z.enum([
  'authentic',
  'user',
  'ai_generated',
  'system_generated',
]);
export type ContentOrigin = z.infer<typeof contentOriginSchema>;

export const sourceTypeSchema = z.enum([
  'real_conversation',
  'chat_session',
  'youtube',
  'article',
  'pdf',
  'web',
  'dictionary',
  'corpus',
  'user_import',
  'user_manual',
  'ai_generated',
  'system_generated',
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/** How a piece of evidence was measured. Drives error-pattern analysis. */
export const modalitySchema = z.enum([
  'recognition',
  'recall',
  'production',
  'listening',
  'transfer',
]);
export type Modality = z.infer<typeof modalitySchema>;

export const activityTypeSchema = z.enum([
  'quick_review',
  'vocabulary_recall',
  'reading',
  'listening',
  'conversation',
  'grammar_practice',
  'writing',
  'pronunciation',
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const activityKindSchema = z.enum([
  'review_recognition',
  'review_recall',
  'review_production',
  'reading_prompt',
  'grammar_choice',
  'writing_prompt',
  'chat_turn',
  /** Warmup exposure card: show-only, never assessed (v0.3 §D1). */
  'warmup_exposure',
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const sessionStatusSchema = z.enum([
  'created',
  'active',
  'paused',
  'completed',
  'abandoned',
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const activityItemStatusSchema = z.enum([
  'pending',
  'answered',
  'skipped',
]);
export type ActivityItemStatus = z.infer<typeof activityItemStatusSchema>;

export const eventTypeSchema = z.enum([
  'goal_created',
  'goal_updated',
  'goal_primary_changed',
  'scenario_created',
  'scenario_updated',
  'scenario_archived',
  'knowledge_imported',
  'knowledge_pool_promoted',
  'session_created',
  'session_started',
  'session_paused',
  'session_resumed',
  'session_completed',
  'session_abandoned',
  'assessment_recorded',
  'activity_skipped',
  'knowledge_added',
  'knowledge_updated',
  'user_feedback',
  'recommendation_offered',
  'recommendation_accepted',
  'recommendation_rejected',
  'chat_message',
  'context_captured',
  'preference_updated',
  'transfer_reported',
  /** Warmup exposure finished; payload: { itemIds } (v0.3 §D1). */
  'warmup_completed',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventSourceSchema = z.enum(['user', 'agent', 'system', 'import']);
export type EventSource = z.infer<typeof eventSourceSchema>;

/**
 * Goal priority (v0.2 §F7). Exactly one goal may be primary at a time;
 * everything else is secondary. Multi-goal without a primary dilutes
 * recommendations, which is the problem this design exists to solve.
 *
 * The single source of truth is the existing pair on the goal row:
 * `isPrimary` (boolean) plus the numeric `priority` used by the scheduler.
 * There is deliberately no second enum, so the two can never disagree.
 */
export const MAX_GOAL_PRIORITY = 5;
export const PRIMARY_GOAL_PRIORITY = 1;

/**
 * Display-level label for a goal, derived from `isPrimary`. Not persisted, so
 * it can never drift from the boolean it describes.
 */
export const goalPrioritySchema = z.enum(['primary', 'secondary']);
export type GoalPriority = z.infer<typeof goalPrioritySchema>;

export const goalPriorityOf = (isPrimary: boolean): GoalPriority =>
  isPrimary ? 'primary' : 'secondary';

/** How a knowledge item entered the library (v0.2 §F4). */
export const knowledgeEntryMethodSchema = z.enum([
  'manual',
  'file_upload',
  'paste',
  'export_restore',
]);
export type KnowledgeEntryMethod = z.infer<typeof knowledgeEntryMethodSchema>;

/** Outcome of one import/export run. */
export const operationStatusSchema = z.enum(['success', 'partial', 'failed']);
export type OperationStatus = z.infer<typeof operationStatusSchema>;

export const operationTypeSchema = z.enum(['import', 'export']);
export type OperationType = z.infer<typeof operationTypeSchema>;

/**
 * Structure of a scenario (v0.2 §F7): a big scenario may contain small ones.
 * Only the user declares scenarios in v0.2 — the system never infers one
 * silently.
 */
export const scenarioTypeSchema = z.enum(['big', 'small']);
export type ScenarioType = z.infer<typeof scenarioTypeSchema>;

export const scenarioStatusSchema = z.enum(['active', 'done']);
export type ScenarioStatus = z.infer<typeof scenarioStatusSchema>;

/**
 * Deterministic time horizon for a scenario. Stored as a preset (not free text)
 * so "expired? -> archive" is a pure rule and never needs an LLM to parse
 * "下周" (v0.2 §F7 生命周期).
 */
export const timeContextPresetSchema = z.enum([
  'today',
  'this_week',
  'next_week',
  'this_month',
  'this_quarter',
  'long_term',
]);
export type TimeContextPreset = z.infer<typeof timeContextPresetSchema>;

/** Action recorded in the knowledge operation log (v0.2 §F5). */
export const knowledgeOperationTypeSchema = z.enum([
  'create',
  'update',
  'delete',
  'promote_to_learning',
  'pause_to_pool',
  'import',
  'export',
  'goal_binding_changed',
]);
export type KnowledgeOperationType = z.infer<typeof knowledgeOperationTypeSchema>;

export const intentSchema = z.enum([
  'learning',
  'practice',
  'conversation',
  'exploration',
  'support',
  'unknown',
]);
export type Intent = z.infer<typeof intentSchema>;

export const trendSchema = z.enum(['improving', 'stable', 'declining', 'unknown']);
export type Trend = z.infer<typeof trendSchema>;

export const subjectTypeSchema = z.enum(['knowledge_item', 'skill', 'goal']);
export type SubjectType = z.infer<typeof subjectTypeSchema>;

export const memoryKindSchema = z.enum([
  'preference',
  'fact',
  'goal_note',
  'correction',
  'interest',
]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const attentionLevelSchema = z.enum(['low', 'medium', 'high']);
export type AttentionLevel = z.infer<typeof attentionLevelSchema>;

export const transferEvidenceTypeSchema = z.enum([
  'self_report',
  'real_world_log',
  'external_test',
  'observed',
]);
export type TransferEvidenceType = z.infer<typeof transferEvidenceTypeSchema>;

export const feedbackKindSchema = z.enum([
  'already_known',
  'not_relevant',
  'too_easy',
  'too_hard',
  'recommendation_rejected',
  'correction_disabled',
  'correction_enabled',
  'chat_only',
  'assessment_corrected',
]);
export type FeedbackKind = z.infer<typeof feedbackKindSchema>;
