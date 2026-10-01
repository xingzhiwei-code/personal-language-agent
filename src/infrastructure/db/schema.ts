
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema (V0.1). Timestamps are ISO-8601 strings for portability and
 * readable exports. Booleans are 0/1 integers. Structured values are JSON text.
 *
 * This file is infrastructure: the domain never imports it.
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  nativeLanguage: text('native_language').notNull().default('zh'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    languageCode: text('language_code').notNull(),
    title: text('title').notNull(),
    rawInput: text('raw_input').notNull().default(''),
    description: text('description'),
    scenarios: text('scenarios', { mode: 'json' }).$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    priority: integer('priority').notNull().default(3),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('goals_learner_idx').on(table.learnerId, table.status),
    index('goals_raw_input_idx').on(table.learnerId, table.rawInput),
  ],
);

export const learningTargets = sqliteTable(
  'learning_targets',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id').notNull(),
    learnerId: text('learner_id').notNull(),
    skill: text('skill').notNull(),
    importance: real('importance').notNull().default(0.5),
    description: text('description'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('targets_goal_idx').on(table.goalId),
    uniqueIndex('targets_goal_skill_uidx').on(table.goalId, table.skill),
  ],
);

export const contentSources = sqliteTable(
  'content_sources',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id'),
    type: text('type').notNull(),
    origin: text('origin').notNull(),
    title: text('title'),
    url: text('url'),
    extractionMethod: text('extraction_method'),
    aiGenerated: integer('ai_generated', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('content_sources_learner_idx').on(table.learnerId)],
);

export const contents = sqliteTable(
  'contents',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    learnerId: text('learner_id'),
    languageCode: text('language_code').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('contents_source_idx').on(table.sourceId)],
);

export const knowledgeItems = sqliteTable(
  'knowledge_items',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    languageCode: text('language_code').notNull(),
    type: text('type').notNull(),
    text: text('text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    meaning: text('meaning'),
    notes: text('notes'),
    examples: text('examples', { mode: 'json' })
      .$type<
        { text: string; translation?: string | null; origin: string; sourceRef?: string | null }[]
      >()
      .notNull()
      .default([]),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    origin: text('origin').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    sourceRef: text('source_ref'),
    aiGenerated: integer('ai_generated', { mode: 'boolean' }).notNull().default(false),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // `figure` (word) and `figure out` (phrase) stay distinct items.
    uniqueIndex('knowledge_unique_idx').on(
      table.learnerId,
      table.languageCode,
      table.type,
      table.normalizedText,
    ),
    index('knowledge_learner_idx').on(table.learnerId, table.status),
    index('knowledge_text_idx').on(table.normalizedText),
  ],
);

export const knowledgeRelations = sqliteTable(
  'knowledge_relations',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    fromItemId: text('from_item_id').notNull(),
    toItemId: text('to_item_id').notNull(),
    type: text('type').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('relations_unique_idx').on(table.fromItemId, table.toItemId, table.type),
    index('relations_from_idx').on(table.fromItemId),
    index('relations_to_idx').on(table.toItemId),
  ],
);

export const learnerStates = sqliteTable(
  'learner_states',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),

    mastery: real('mastery').notNull().default(0),
    confidence: real('confidence').notNull().default(0),

    exposureCount: integer('exposure_count').notNull().default(0),
    successfulAttempts: integer('successful_attempts').notNull().default(0),
    failedAttempts: integer('failed_attempts').notNull().default(0),

    recentPerformance: real('recent_performance').notNull().default(0),
    historicalPerformance: real('historical_performance').notNull().default(0),

    stabilityDays: real('stability_days').notNull().default(0),
    easeFactor: real('ease_factor').notNull().default(2.5),
    repetitions: integer('repetitions').notNull().default(0),
    retrievalStrength: real('retrieval_strength').notNull().default(0),

    modalityStats: text('modality_stats', { mode: 'json' })
      .$type<Record<string, { attempts: number; successes: number; strength: number; lastAt: string | null }>>()
      .notNull()
      .default({}),
    recentEvidence: text('recent_evidence', { mode: 'json' })
      .$type<
        { modality: string; score: number; difficulty: number | null; occurredAt: string }[]
      >()
      .notNull()
      .default([]),

    transferScore: real('transfer_score'),
    transferConfidence: real('transfer_confidence'),

    trend: text('trend').notNull().default('unknown'),
    lastPracticedAt: text('last_practiced_at'),
    nextReviewAt: text('next_review_at'),
    userDeclaredMastered: integer('user_declared_mastered', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('states_subject_uidx').on(table.learnerId, table.subjectType, table.subjectId),
    index('states_due_idx').on(table.learnerId, table.nextReviewAt),
    index('states_mastery_idx').on(table.learnerId, table.subjectType, table.mastery),
  ],
);

export const learningEvents = sqliteTable(
  'learning_events',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    sessionId: text('session_id'),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    source: text('source').notNull(),
    version: integer('version').notNull().default(1),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('events_idempotency_uidx').on(table.learnerId, table.idempotencyKey),
    index('events_learner_time_idx').on(table.learnerId, table.occurredAt),
    index('events_session_idx').on(table.sessionId),
  ],
);

export const assessments = sqliteTable(
  'assessments',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    eventId: text('event_id').notNull(),
    sessionId: text('session_id'),
    activityId: text('activity_id'),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    modality: text('modality').notNull(),
    score: real('score').notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    difficulty: real('difficulty'),
    responseTimeMs: integer('response_time_ms'),
    userAnswer: text('user_answer'),
    expectedAnswer: text('expected_answer'),
    source: text('source').notNull(),
    userCorrected: integer('user_corrected', { mode: 'boolean' }).notNull().default(false),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    uniqueIndex('assessments_event_uidx').on(table.eventId),
    index('assessments_subject_idx').on(table.learnerId, table.subjectId, table.occurredAt),
    index('assessments_session_idx').on(table.sessionId),
  ],
);

export const learningSessions = sqliteTable(
  'learning_sessions',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    goalId: text('goal_id'),
    recommendationId: text('recommendation_id'),
    activityType: text('activity_type').notNull(),
    status: text('status').notNull().default('created'),
    plannedDurationMinutes: integer('planned_duration_minutes'),
    correctionEnabled: integer('correction_enabled', { mode: 'boolean' }).notNull().default(true),
    startedAt: text('started_at'),
    lastActiveAt: text('last_active_at'),
    pausedAt: text('paused_at'),
    endedAt: text('ended_at'),
    summary: text('summary', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    clientToken: text('client_token'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('sessions_token_uidx').on(table.learnerId, table.clientToken),
    index('sessions_learner_status_idx').on(table.learnerId, table.status, table.updatedAt),
  ],
);

export const learningActivities = sqliteTable(
  'learning_activities',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    learnerId: text('learner_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    modality: text('modality').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    prompt: text('prompt').notNull(),
    options: text('options', { mode: 'json' }).$type<string[] | null>(),
    expectedAnswer: text('expected_answer'),
    hint: text('hint'),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('activities_session_idx').on(table.sessionId, table.position),
    uniqueIndex('activities_session_position_uidx').on(table.sessionId, table.position),
  ],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    learnerId: text('learner_id').notNull(),
    role: text('role').notNull(),
    text: text('text').notNull(),
    aiGenerated: integer('ai_generated', { mode: 'boolean' }).notNull().default(false),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('chat_session_idx').on(table.sessionId, table.createdAt)],
);

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    content: text('content').notNull(),
    confidence: real('confidence').notNull().default(0.3),
    evidenceCount: integer('evidence_count').notNull().default(1),
    lastObservedAt: text('last_observed_at').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('memories_key_uidx').on(table.learnerId, table.key)],
);

export const learningPreferences = sqliteTable(
  'learning_preferences',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    confidence: real('confidence').notNull().default(0.3),
    evidenceCount: integer('evidence_count').notNull().default(1),
    source: text('source').notNull().default('inferred'),
    lastObservedAt: text('last_observed_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('preferences_key_uidx').on(table.learnerId, table.key)],
);

export const userContexts = sqliteTable(
  'user_contexts',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    capturedAt: text('captured_at').notNull(),
    availableMinutes: integer('available_minutes'),
    device: text('device').notNull().default('unknown'),
    canSpeak: integer('can_speak', { mode: 'boolean' }).notNull().default(true),
    canListen: integer('can_listen', { mode: 'boolean' }).notNull().default(true),
    canType: integer('can_type', { mode: 'boolean' }).notNull().default(true),
    canRead: integer('can_read', { mode: 'boolean' }).notNull().default(true),
    attention: text('attention').notNull().default('medium'),
    intent: text('intent').notNull().default('unknown'),
    note: text('note'),
    rawInput: text('raw_input'),
  },
  (table) => [index('contexts_learner_idx').on(table.learnerId, table.capturedAt)],
);

export const recommendations = sqliteTable(
  'recommendations',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    goalId: text('goal_id'),
    activityType: text('activity_type').notNull(),
    score: real('score').notNull(),
    reason: text('reason').notNull(),
    factors: text('factors', { mode: 'json' }).$type<Record<string, number>>().notNull().default({}),
    subjectIds: text('subject_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    plannedDurationMinutes: integer('planned_duration_minutes').notNull(),
    estimatedItemCount: integer('estimated_item_count').notNull().default(0),
    status: text('status').notNull().default('offered'),
    requiresAi: integer('requires_ai', { mode: 'boolean' }).notNull().default(false),
    generatedAt: text('generated_at').notNull(),
  },
  (table) => [index('recommendations_learner_idx').on(table.learnerId, table.generatedAt)],
);

export const transferEvidences = sqliteTable(
  'transfer_evidences',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    goalId: text('goal_id'),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    scenario: text('scenario').notNull(),
    evidenceType: text('evidence_type').notNull(),
    score: real('score').notNull(),
    confidence: real('confidence').notNull(),
    note: text('note'),
    occurredAt: text('occurred_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('transfer_learner_idx').on(table.learnerId, table.occurredAt)],
);

/**
 * NOTE: the `_migrations` bookkeeping table is created by the migration runner
 * itself (`runMigrations`), not by drizzle-kit, so it is intentionally absent
 * from this schema.
 */

export const schema = {
  users,
  goals,
  learningTargets,
  contentSources,
  contents,
  knowledgeItems,
  knowledgeRelations,
  learnerStates,
  learningEvents,
  assessments,
  learningSessions,
  learningActivities,
  chatMessages,
  memories,
  learningPreferences,
  userContexts,
  recommendations,
  transferEvidences,
};
