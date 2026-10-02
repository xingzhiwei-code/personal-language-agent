import { z } from 'zod';
import {
  activityItemStatusSchema,
  activityKindSchema,
  activityTypeSchema,
  attentionLevelSchema,
  contentOriginSchema,
  eventSourceSchema,
  eventTypeSchema,
  feedbackKindSchema,
  goalStatusSchema,
  intentSchema,
  knowledgeEntryMethodSchema,
  knowledgeOperationTypeSchema,
  knowledgeRelationTypeSchema,
  knowledgeStatusSchema,
  knowledgeTypeSchema,
  languageCodeSchema,
  memoryKindSchema,
  modalitySchema,
  operationStatusSchema,
  operationTypeSchema,
  scenarioStatusSchema,
  scenarioTypeSchema,
  sessionStatusSchema,
  skillKindSchema,
  sourceTypeSchema,
  subjectTypeSchema,
  timeContextPresetSchema,
  transferEvidenceTypeSchema,
  trendSchema,
} from './enums';
import type { Modality } from './enums';

export const idSchema = z.string().min(1).max(64);
export type Id = z.infer<typeof idSchema>;

/** ISO-8601 UTC timestamp string. Stored as text for readability/portability. */
export const timestampSchema = z.string().datetime({ offset: false });
export type Timestamp = z.infer<typeof timestampSchema>;

export const unitScoreSchema = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// User / learner
// ---------------------------------------------------------------------------

export const userSchema = z.object({
  id: idSchema,
  displayName: z.string().min(1).max(80),
  nativeLanguage: languageCodeSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type User = z.infer<typeof userSchema>;

// ---------------------------------------------------------------------------
// Goal / LearningTarget / Skill
// ---------------------------------------------------------------------------

export const goalSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  languageCode: languageCodeSchema,
  title: z.string().min(1).max(200),
  rawInput: z.string().max(2000),
  description: z.string().max(2000).nullable(),
  scenarios: z.array(z.string().min(1).max(80)).max(20),
  status: goalStatusSchema,
  priority: z.number().int().min(1).max(5),
  isPrimary: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Goal = z.infer<typeof goalSchema>;

export const learningTargetSchema = z.object({
  id: idSchema,
  goalId: idSchema,
  learnerId: idSchema,
  skill: skillKindSchema,
  /** Relative importance of this skill for the goal (0..1). */
  importance: unitScoreSchema,
  description: z.string().max(500).nullable(),
  status: goalStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LearningTarget = z.infer<typeof learningTargetSchema>;

// ---------------------------------------------------------------------------
// Content source (provenance)
// ---------------------------------------------------------------------------

export const contentSourceSchema = z.object({
  id: idSchema,
  learnerId: idSchema.nullable(),
  type: sourceTypeSchema,
  origin: contentOriginSchema,
  title: z.string().max(300).nullable(),
  url: z.string().max(2000).nullable(),
  extractionMethod: z.string().max(120).nullable(),
  aiGenerated: z.boolean(),
  createdAt: timestampSchema,
});
export type ContentSource = z.infer<typeof contentSourceSchema>;

export const contentSchema = z.object({
  id: idSchema,
  sourceId: idSchema,
  learnerId: idSchema.nullable(),
  languageCode: languageCodeSchema,
  kind: z.enum(['text', 'sentence', 'dialogue', 'note']),
  text: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: timestampSchema,
});
export type Content = z.infer<typeof contentSchema>;

// ---------------------------------------------------------------------------
// Knowledge graph
// ---------------------------------------------------------------------------

export const knowledgeExampleSchema = z.object({
  text: z.string().min(1).max(600),
  translation: z.string().max(600).nullable().optional(),
  origin: contentOriginSchema,
  sourceRef: z.string().max(300).nullable().optional(),
});
export type KnowledgeExample = z.infer<typeof knowledgeExampleSchema>;

export const knowledgeItemSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  languageCode: languageCodeSchema,
  type: knowledgeTypeSchema,
  /** Surface form exactly as learned, e.g. "figure out". */
  text: z.string().min(1).max(400),
  /** Normalised form used for de-duplication within (learner, language, type). */
  normalizedText: z.string().min(1).max(400),
  meaning: z.string().max(2000).nullable(),
  notes: z.string().max(2000).nullable(),
  examples: z.array(knowledgeExampleSchema).max(20),
  tags: z.array(z.string().min(1).max(40)).max(20),
  origin: contentOriginSchema,
  sourceType: sourceTypeSchema,
  sourceId: idSchema.nullable(),
  sourceRef: z.string().max(2000).nullable(),
  aiGenerated: z.boolean(),
  status: knowledgeStatusSchema,
  /**
   * Which imported wordlist this item came from (v0.2 §F1). Null for manually
   * added items. Drives the `wordlist_binding` term of the relevance score.
   */
  wordlistId: idSchema.nullable(),
  /** How this item entered the library; drives the operation log's `source`. */
  entryMethod: knowledgeEntryMethodSchema,
  /**
   * Normalised frequency rank within its import batch (0..1, lower = more
   * common). Null when unknown, which the relevance score treats as neutral.
   */
  frequencyRank: z.number().min(0).max(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

export const knowledgeRelationSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  fromItemId: idSchema,
  toItemId: idSchema,
  type: knowledgeRelationTypeSchema,
  note: z.string().max(500).nullable(),
  createdAt: timestampSchema,
});
export type KnowledgeRelation = z.infer<typeof knowledgeRelationSchema>;

// ---------------------------------------------------------------------------
// Learner state
// ---------------------------------------------------------------------------

export const evidenceSchema = z.object({
  modality: modalitySchema,
  score: unitScoreSchema,
  /** Optional difficulty of the item that produced the evidence (0..1). */
  difficulty: unitScoreSchema.nullable(),
  occurredAt: timestampSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const modalityStatSchema = z.object({
  attempts: z.number().int().min(0),
  successes: z.number().int().min(0),
  /** 0..1 strength estimate for this modality. */
  strength: unitScoreSchema,
  lastAt: timestampSchema.nullable(),
});
export type ModalityStat = z.infer<typeof modalityStatSchema>;

export const learnerStateSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  subjectType: subjectTypeSchema,
  subjectId: z.string().min(1).max(120),

  mastery: unitScoreSchema,
  confidence: unitScoreSchema,

  exposureCount: z.number().int().min(0),
  successfulAttempts: z.number().int().min(0),
  failedAttempts: z.number().int().min(0),

  recentPerformance: unitScoreSchema,
  historicalPerformance: unitScoreSchema,

  /** Retention interval in days (SRS). */
  stabilityDays: z.number().min(0),
  easeFactor: z.number().min(1.3).max(3.2),
  repetitions: z.number().int().min(0),
  /** 0..1 strength of the memory trace right after the last practice. */
  retrievalStrength: unitScoreSchema,

  modalityStats: z.record(modalitySchema, modalityStatSchema),
  /** Bounded window of the most recent evidence, used for recentScore. */
  recentEvidence: z.array(evidenceSchema).max(12),

  transferScore: unitScoreSchema.nullable(),
  transferConfidence: unitScoreSchema.nullable(),

  trend: trendSchema,
  lastPracticedAt: timestampSchema.nullable(),
  nextReviewAt: timestampSchema.nullable(),
  /** Set when the user declares "I already know this". */
  userDeclaredMastered: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * `modalityStats` only contains the modalities that were actually measured, so
 * the TypeScript type is a partial record (the zod schema validates values).
 */
export type LearnerState = Omit<
  z.infer<typeof learnerStateSchema>,
  'modalityStats' | 'recentEvidence'
> & {
  modalityStats: Partial<Record<Modality, ModalityStat>>;
  recentEvidence: Evidence[];
};

// ---------------------------------------------------------------------------
// Events / assessments
// ---------------------------------------------------------------------------

export const learningEventSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  sessionId: idSchema.nullable(),
  type: eventTypeSchema,
  occurredAt: timestampSchema,
  payload: z.record(z.unknown()),
  source: eventSourceSchema,
  version: z.number().int().min(1),
  /** Guarantees idempotent writes for retried/duplicated submissions. */
  idempotencyKey: z.string().min(1).max(200),
  createdAt: timestampSchema,
});
export type LearningEvent = z.infer<typeof learningEventSchema>;

export const assessmentSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  eventId: idSchema,
  sessionId: idSchema.nullable(),
  activityId: idSchema.nullable(),
  subjectType: subjectTypeSchema,
  subjectId: z.string().min(1).max(120),
  modality: modalitySchema,
  score: unitScoreSchema,
  correct: z.boolean(),
  difficulty: unitScoreSchema.nullable(),
  responseTimeMs: z.number().int().min(0).nullable(),
  userAnswer: z.string().max(4000).nullable(),
  expectedAnswer: z.string().max(4000).nullable(),
  source: eventSourceSchema,
  /** True when the learner overrode the system's judgement. */
  userCorrected: z.boolean(),
  occurredAt: timestampSchema,
});
export type Assessment = z.infer<typeof assessmentSchema>;

// ---------------------------------------------------------------------------
// Sessions and activities
// ---------------------------------------------------------------------------

export const sessionSummarySchema = z.object({
  completedItems: z.number().int().min(0),
  correctItems: z.number().int().min(0),
  skippedItems: z.number().int().min(0),
  difficulties: z.array(z.string().max(300)).max(20),
  knowledgeItemIds: z.array(idSchema).max(100),
  note: z.string().max(1000).nullable(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const learningSessionSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  goalId: idSchema.nullable(),
  recommendationId: idSchema.nullable(),
  activityType: activityTypeSchema,
  status: sessionStatusSchema,
  plannedDurationMinutes: z.number().int().min(1).max(180).nullable(),
  correctionEnabled: z.boolean(),
  startedAt: timestampSchema.nullable(),
  lastActiveAt: timestampSchema.nullable(),
  pausedAt: timestampSchema.nullable(),
  endedAt: timestampSchema.nullable(),
  summary: sessionSummarySchema.nullable(),
  /** Idempotency token supplied by the UI to avoid duplicate sessions. */
  clientToken: z.string().max(200).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LearningSession = z.infer<typeof learningSessionSchema>;

export const learningActivitySchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  learnerId: idSchema,
  position: z.number().int().min(0),
  kind: activityKindSchema,
  modality: modalitySchema,
  subjectType: subjectTypeSchema,
  subjectId: z.string().min(1).max(120),
  prompt: z.string().min(1).max(2000),
  /** Optional multiple-choice options for recognition items. */
  options: z.array(z.string().min(1).max(400)).max(6).nullable(),
  expectedAnswer: z.string().max(2000).nullable(),
  hint: z.string().max(600).nullable(),
  status: activityItemStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LearningActivity = z.infer<typeof learningActivitySchema>;

export const chatMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  learnerId: idSchema,
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string().min(1).max(8000),
  /** Set when the assistant text was produced by an LLM. */
  aiGenerated: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: timestampSchema,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ---------------------------------------------------------------------------
// Memory / preference / context / recommendation / transfer
// ---------------------------------------------------------------------------

export const memorySchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  kind: memoryKindSchema,
  /** Stable key enables "observed again" reinforcement instead of duplicates. */
  key: z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
  confidence: unitScoreSchema,
  evidenceCount: z.number().int().min(1),
  lastObservedAt: timestampSchema,
  status: z.enum(['active', 'retired']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Memory = z.infer<typeof memorySchema>;

export const learningPreferenceSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
  confidence: unitScoreSchema,
  evidenceCount: z.number().int().min(1),
  source: z.enum(['user_explicit', 'inferred']),
  lastObservedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LearningPreference = z.infer<typeof learningPreferenceSchema>;

export const userContextSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  capturedAt: timestampSchema,
  availableMinutes: z.number().int().min(1).max(240).nullable(),
  device: z.enum(['desktop', 'mobile', 'unknown']),
  canSpeak: z.boolean(),
  canListen: z.boolean(),
  canType: z.boolean(),
  canRead: z.boolean(),
  attention: attentionLevelSchema,
  intent: intentSchema,
  note: z.string().max(500).nullable(),
  /** Free-text the user typed, kept for traceability of the parsed context. */
  rawInput: z.string().max(1000).nullable(),
});
export type UserContext = z.infer<typeof userContextSchema>;

export const recommendationFactorsSchema = z.object({
  learningValue: z.number(),
  urgency: z.number(),
  goalAlignment: z.number(),
  contextFit: z.number(),
  durationFit: z.number(),
  preferenceFit: z.number(),
  novelty: z.number(),
  repetitionPenalty: z.number(),
  friction: z.number(),
});
export type RecommendationFactors = z.infer<typeof recommendationFactorsSchema>;

export const recommendationSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  goalId: idSchema.nullable(),
  activityType: activityTypeSchema,
  score: z.number(),
  reason: z.string().min(1).max(400),
  factors: recommendationFactorsSchema,
  subjectIds: z.array(z.string().min(1).max(120)).max(50),
  plannedDurationMinutes: z.number().int().min(1).max(180),
  estimatedItemCount: z.number().int().min(0),
  status: z.enum(['offered', 'accepted', 'rejected', 'expired']),
  requiresAi: z.boolean(),
  generatedAt: timestampSchema,
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const transferEvidenceSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  goalId: idSchema.nullable(),
  subjectType: subjectTypeSchema,
  subjectId: z.string().min(1).max(120),
  scenario: z.string().min(1).max(300),
  evidenceType: transferEvidenceTypeSchema,
  score: unitScoreSchema,
  confidence: unitScoreSchema,
  note: z.string().max(1000).nullable(),
  occurredAt: timestampSchema,
  createdAt: timestampSchema,
});
export type TransferEvidence = z.infer<typeof transferEvidenceSchema>;

/**
 * Deterministic time horizon for a scenario. Stored as a preset (not free text)
 * so "does it expire?" is a pure rule and never needs an LLM to parse "下周"
 * (v0.2 §F7 生命周期). `free_text` is kept for display only.
 */
export const timeContextSchema = z.object({
  preset: timeContextPresetSchema,
  /** Original words the user typed, e.g. "下周去旅游". Display only. */
  freeText: z.string().max(120).nullable(),
  /**
   * Resolved deadline, computed from `preset` + the declared date. Null for
   * `long_term`, which never expires.
   */
  resolvedDueAt: timestampSchema.nullable(),
});
export type TimeContext = z.infer<typeof timeContextSchema>;

export const scenarioSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  /** Optional: a scenario can exist independently of any goal. */
  goalId: idSchema.nullable(),
  /** Set when this is a small scenario inside a big one. */
  parentId: idSchema.nullable(),
  name: z.string().min(1).max(120),
  type: scenarioTypeSchema,
  timeContext: timeContextSchema.nullable(),
  status: scenarioStatusSchema,
  /** Knowledge items the user attached to this scenario (e.g. from F2). */
  knowledgeItemIds: z.array(idSchema).max(20_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Scenario = z.infer<typeof scenarioSchema>;

/**
 * A named collection of imported knowledge (v0.2 §F1). It is the unit that a
 * goal is bound to for relevance scoring, and what the pool browser groups by.
 */
export const wordlistSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  name: z.string().min(1).max(120),
  languageCode: languageCodeSchema,
  /** Which goal this wordlist serves; drives relevance scoring (v0.2 §F6). */
  goalId: idSchema.nullable(),
  /** Lowercased keywords used for tag matching in the relevance score. */
  tags: z.array(z.string().min(1).max(40)).max(20),
  sourceFile: z.string().max(300).nullable(),
  itemCount: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Wordlist = z.infer<typeof wordlistSchema>;

/**
 * One import or export run (v0.2 §F4). `fileHash` is the idempotency key for
 * imports: the same file imported twice adds zero rows and is reported as a
 * duplicate instead. Exports record metadata only, never content.
 */
export const importExportHistorySchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  type: operationTypeSchema,
  method: knowledgeEntryMethodSchema,
  /** File name, wordlist name or paste title. */
  sourceLabel: z.string().min(1).max(300),
  /** SHA-256 hex of the uploaded bytes. Null for exports and pastes. */
  fileHash: z.string().max(128).nullable(),
  format: z.string().min(1).max(20),
  totalCount: z.number().int().min(0),
  addedCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  status: operationStatusSchema,
  /** Per-row failures, capped so one bad file cannot bloat the table. */
  errors: z.array(z.object({ row: z.number().int().min(0), reason: z.string().max(300) })).max(50),
  wordlistId: idSchema.nullable(),
  goalId: idSchema.nullable(),
  createdAt: timestampSchema,
});
export type ImportExportHistory = z.infer<typeof importExportHistorySchema>;

/**
 * Data-management audit trail (v0.2 §F5).
 *
 * Deliberately separate from `LearningEvent`: an event is an immutable fact
 * about learning and the only input to the Learner Model, while this log
 * records what was done to the library. Mixing them would let a bulk import
 * pollute the learner's evidence.
 */
export const knowledgeOperationLogSchema = z.object({
  id: idSchema,
  learnerId: idSchema,
  operation: knowledgeOperationTypeSchema,
  /** Null for library-wide operations such as an export. */
  knowledgeItemId: idSchema.nullable(),
  /** Snapshot of the text at the time of the operation, for readability. */
  itemText: z.string().max(400).nullable(),
  /** Only the fields that changed, e.g. `{ status: ['new', 'active'] }`. */
  changes: z.record(z.unknown()),
  source: knowledgeEntryMethodSchema,
  note: z.string().max(500).nullable(),
  createdAt: timestampSchema,
});
export type KnowledgeOperationLog = z.infer<typeof knowledgeOperationLogSchema>;

export const userFeedbackSchema = z.object({
  kind: feedbackKindSchema,
  subjectType: subjectTypeSchema.nullable(),
  subjectId: z.string().max(120).nullable(),
  sessionId: idSchema.nullable(),
  note: z.string().max(1000).nullable(),
});
export type UserFeedback = z.infer<typeof userFeedbackSchema>;
