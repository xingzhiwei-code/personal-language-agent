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

export const knowledgeStatusSchema = z.enum([
  'active',
  'user_mastered',
  'irrelevant',
  'archived',
]);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

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
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventSourceSchema = z.enum(['user', 'agent', 'system', 'import']);
export type EventSource = z.infer<typeof eventSourceSchema>;

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
