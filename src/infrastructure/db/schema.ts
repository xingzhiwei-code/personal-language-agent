
import { sql } from 'drizzle-orm';
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
    /** v0.4 §G2: phase-template selector ('ielts' | 'general'). */
    goalType: text('goal_type').notNull().default('general'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('goals_learner_idx').on(table.learnerId, table.status),
    uniqueIndex('goals_one_primary_uidx')
      .on(table.learnerId)
      .where(sql`${table.isPrimary} = 1`),
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
    /**
     * Lifecycle (v0.2 §F6):
     *   'new'    = in the import pool; NOT in the SRS due queue.
     *   'active' = in study; eligible for review scheduling.
     *   other values: user_mastered / irrelevant / archived.
     */
    status: text('status').notNull().default('active'),
    /**
     * Which imported wordlist this item came from (v0.2 §F1).
     * Null for manually-added items.
     */
    wordlistId: text('wordlist_id'),
    /** How the item entered the library (v0.2 §F4). */
    entryMethod: text('entry_method').notNull().default('manual'),
    /**
     * Normalised frequency rank within its import batch (0..1, lower = more
     * common). Null when unknown.
     */
    frequencyRank: real('frequency_rank'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // Legacy type-scoped index is retained for migration compatibility.
    // v0.2 cross-type de-duplication is enforced by migration triggers + services.
    uniqueIndex('knowledge_unique_idx').on(
      table.learnerId,
      table.languageCode,
      table.type,
      table.normalizedText,
    ),
    index('knowledge_learner_idx').on(table.learnerId, table.status),
    index('knowledge_wordlist_status_idx').on(table.learnerId, table.wordlistId, table.status),
    index('knowledge_pool_page_idx').on(table.learnerId, table.status, table.updatedAt, table.id),
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

// ── v0.2 tables ──────────────────────────────────────────────────────────────

/**
 * A named collection of imported knowledge (v0.2 §F1). Goals bind to wordlists
 * for relevance scoring; the pool browser groups items by wordlist.
 */
export const wordlists = sqliteTable(
  'wordlists',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    name: text('name').notNull(),
    languageCode: text('language_code').notNull().default('en'),
    /** Which goal this wordlist serves. Drives wordlist-binding relevance term. */
    goalId: text('goal_id'),
    /** JSON array of lowercase tag strings for tag-matching in relevance score. */
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    sourceFile: text('source_file'),
    itemCount: integer('item_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('wordlists_learner_idx').on(table.learnerId),
    index('wordlists_goal_idx').on(table.goalId),
  ],
);

/**
 * One import or export run (v0.2 §F4). `fileHash` is the idempotency key for
 * imports: the same file imported twice records 0 added and is shown as a
 * duplicate. Exports record metadata only, never content.
 */
export const importExportHistory = sqliteTable(
  'import_export_history',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    type: text('type').notNull(), // 'import' | 'export'
    method: text('method').notNull(), // knowledgeEntryMethod
    sourceLabel: text('source_label').notNull(),
    /** SHA-256 hex of the uploaded bytes. Null for exports and paste imports. */
    fileHash: text('file_hash'),
    format: text('format').notNull().default('json'),
    totalCount: integer('total_count').notNull().default(0),
    addedCount: integer('added_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: text('status').notNull().default('success'), // operationStatus
    /** JSON array of {row, reason} objects, max 50. */
    errors: text('errors', { mode: 'json' })
      .$type<{ row: number; reason: string }[]>()
      .notNull()
      .default([]),
    wordlistId: text('wordlist_id'),
    goalId: text('goal_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('ie_history_learner_idx').on(table.learnerId, table.createdAt),
    /** Idempotency: one canonical import record per non-null file hash. */
    uniqueIndex('ie_history_import_hash_uidx')
      .on(table.learnerId, table.fileHash)
      .where(sql`${table.type} = 'import' AND ${table.fileHash} IS NOT NULL`),
  ],
);

/**
 * Data-management audit trail (v0.2 §F5). Deliberately separate from
 * `learning_events` — events track learning facts; this table tracks library
 * management actions. Mixing them would pollute the Learner Model's evidence.
 * Logs are append-only: deletions are recorded, not undone.
 */
export const knowledgeOperationLog = sqliteTable(
  'knowledge_operation_log',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    operation: text('operation').notNull(), // knowledgeOperationType
    knowledgeItemId: text('knowledge_item_id'),
    itemText: text('item_text'),
    /** JSON object of changed fields: { fieldName: [before, after] }. */
    changes: text('changes', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    source: text('source').notNull().default('manual'), // knowledgeEntryMethod
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('op_log_learner_idx').on(table.learnerId, table.createdAt),
    index('op_log_item_idx').on(table.knowledgeItemId),
  ],
);

/**
 * Scenarios (v0.2 §F7): tree of user-declared contexts that boost scheduler
 * weighting while active and auto-archive when their deadline passes.
 */
export const scenarios = sqliteTable(
  'scenarios',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    goalId: text('goal_id'),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    type: text('type').notNull().default('big'), // 'big' | 'small'
    /** JSON: { preset, freeText, resolvedDueAt } */
    timeContext: text('time_context', { mode: 'json' })
      .$type<{
        preset: string;
        freeText: string | null;
        resolvedDueAt: string | null;
      } | null>()
      .default(null),
    status: text('status').notNull().default('active'), // 'active' | 'done'
    /** JSON array of knowledge item IDs linked to this scenario. */
    knowledgeItemIds: text('knowledge_item_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('scenarios_learner_idx').on(table.learnerId, table.status),
    index('scenarios_goal_idx').on(table.goalId),
    index('scenarios_parent_idx').on(table.parentId),
  ],
);

// ── v0.4 tables ──────────────────────────────────────────────────────────────

/**
 * Level placement records (v0.4 §G1). Append-only: the latest row is the
 * current starting level; a placement never overwrites or deletes older ones.
 */
export const placements = sqliteTable(
  'placements',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    type: text('type').notNull(), // placementType: test | self_report | override
    skills: text('skills', { mode: 'json' }).$type<Record<string, number | null>>().notNull(),
    overallLevel: real('overall_level').notNull(),
    confidence: text('confidence').notNull(), // high | medium | low
    evidence: text('evidence', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('placements_learner_idx').on(table.learnerId, table.createdAt)],
);

/**
 * Goal phases (v0.4 §G2). Exactly one phase per goal may be `active`, enforced
 * by a partial unique index (same pattern as `goals_one_primary_uidx`).
 */
export const goalPhases = sqliteTable(
  'goal_phases',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id').notNull(),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    topicSequence: text('topic_sequence', { mode: 'json' }).$type<string[]>().notNull().default([]),
    entryCriteria: text('entry_criteria', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    exitCriteria: text('exit_criteria', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text('status').notNull().default('locked'), // locked | active | done
    progressCache: text('progress_cache', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('goal_phases_goal_idx').on(table.goalId, table.seq),
    uniqueIndex('goal_phases_one_active_uidx')
      .on(table.goalId)
      .where(sql`${table.status} = 'active'`),
  ],
);

/**
 * Offline semantic word relations (v0.4 §G3). Imported once by an idempotent
 * script; never generated by an LLM at runtime.
 */
export const wordRelations = sqliteTable(
  'word_relations',
  {
    id: text('id').primaryKey(),
    wordLemma: text('word_lemma').notNull(),
    relatedLemma: text('related_lemma').notNull(),
    relationType: text('relation_type').notNull(), // topic | synonym | antonym | word_family
    topic: text('topic'),
    source: text('source').notNull(), // wordnet | topic_list
  },
  (table) => [
    index('word_relations_lemma_idx').on(table.wordLemma, table.relationType),
    uniqueIndex('word_relations_unique_idx').on(
      table.wordLemma,
      table.relatedLemma,
      table.relationType,
      table.topic,
    ),
  ],
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
  // v0.2
  wordlists,
  importExportHistory,
  knowledgeOperationLog,
  scenarios,
  // v0.4
  placements,
  goalPhases,
  wordRelations,
};
