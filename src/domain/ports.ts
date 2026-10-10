import type {
  Assessment,
  ChatMessage,
  Content,
  ContentSource,
  Goal,
  GoalPhase,
  ImportExportHistory,
  KnowledgeItem,
  KnowledgeOperationLog,
  KnowledgeRelation,
  LearnerState,
  LearningActivity,
  LearningEvent,
  LearningPreference,
  LearningSession,
  LearningTarget,
  Memory,
  Placement,
  Recommendation,
  Scenario,
  TransferEvidence,
  User,
  UserContext,
  WordRelation,
  Wordlist,
} from './entities';
import type {
  ActivityType,
  KnowledgeRelationType,
  KnowledgeStatus,
  KnowledgeType,
  SessionStatus,
  SubjectType,
} from './enums';

/**
 * Ports (interfaces) owned by the domain. Infrastructure implements them.
 * Dependency direction: Domain <- Application <- Infrastructure <- UI.
 */

export interface Clock {
  now(): Date;
  nowIso(): string;
}

export interface IdGenerator {
  next(): string;
}

/** File/blob storage abstraction. V0.1 default implementation is local disk. */
export interface ObjectStorage {
  put(key: string, data: Uint8Array | string, contentType?: string): Promise<{ key: string }>;
  get(key: string): Promise<Uint8Array | null>;
  getText(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  upsert(user: User): Promise<User>;
}

export interface GoalRepository {
  create(goal: Goal): Promise<Goal>;
  /** Clears the previous primary and inserts this goal in one transaction. */
  createAsPrimary(goal: Goal): Promise<Goal>;
  update(goal: Goal): Promise<Goal>;
  /** Clears the previous primary and updates this goal in one transaction. */
  setPrimary(goal: Goal): Promise<Goal>;
  findById(id: string): Promise<Goal | null>;
  listByLearner(learnerId: string, statuses?: Goal['status'][]): Promise<Goal[]>;
  findPrimary(learnerId: string): Promise<Goal | null>;
  clearPrimary(learnerId: string): Promise<void>;
  /**
   * Latest goal created from the exact same raw input. The application layer
   * decides (using its Clock) whether it is recent enough to reuse, so the
   * repository stays free of time logic.
   */
  findLatestByRawInput(learnerId: string, rawInput: string): Promise<Goal | null>;
}

export interface LearningTargetRepository {
  createMany(targets: LearningTarget[]): Promise<LearningTarget[]>;
  update(target: LearningTarget): Promise<LearningTarget>;
  listByGoal(goalId: string): Promise<LearningTarget[]>;
  listByLearner(learnerId: string): Promise<LearningTarget[]>;
  deleteByGoal(goalId: string): Promise<void>;
}

export interface KnowledgeSearchQuery {
  learnerId: string;
  text?: string;
  types?: KnowledgeType[];
  statuses?: KnowledgeStatus[];
  tags?: string[];
  wordlistIds?: string[];
  limit?: number;
  offset?: number;
}

export interface KnowledgeRepository {
  create(item: KnowledgeItem): Promise<KnowledgeItem>;
  update(item: KnowledgeItem): Promise<KnowledgeItem>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<KnowledgeItem | null>;
  findByNormalized(
    learnerId: string,
    languageCode: string,
    type: KnowledgeType,
    normalizedText: string,
  ): Promise<KnowledgeItem | null>;
  findAnyByNormalized(
    learnerId: string,
    languageCode: string,
    normalizedText: string,
  ): Promise<KnowledgeItem | null>;
  /** Used by import preview for deterministic, type-independent de-duplication. */
  listNormalizedByLanguage(learnerId: string, languageCode: string): Promise<string[]>;
  /** Batch lookup for import completion: returns items matching the given normalised forms. */
  listByNormalizedTexts(
    learnerId: string,
    languageCode: string,
    normalizedTexts: string[],
  ): Promise<KnowledgeItem[]>;
  search(query: KnowledgeSearchQuery): Promise<KnowledgeItem[]>;
  count(query: KnowledgeSearchQuery): Promise<number>;
  listByIds(ids: string[]): Promise<KnowledgeItem[]>;
}

export interface KnowledgeRelationRepository {
  create(relation: KnowledgeRelation): Promise<KnowledgeRelation>;
  delete(id: string): Promise<void>;
  listByItem(itemId: string): Promise<KnowledgeRelation[]>;
  find(
    fromItemId: string,
    toItemId: string,
    type: KnowledgeRelationType,
  ): Promise<KnowledgeRelation | null>;
  listByLearner(learnerId: string): Promise<KnowledgeRelation[]>;
}

export interface LearnerStateRepository {
  find(
    learnerId: string,
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<LearnerState | null>;
  upsert(state: LearnerState): Promise<LearnerState>;
  listBySubjectType(learnerId: string, subjectType: SubjectType): Promise<LearnerState[]>;
  listBySubjectIds(
    learnerId: string,
    subjectType: SubjectType,
    subjectIds: string[],
  ): Promise<LearnerState[]>;
  listDueForReview(learnerId: string, nowIso: string, limit: number): Promise<LearnerState[]>;
  listWeakest(learnerId: string, subjectType: SubjectType, limit: number): Promise<LearnerState[]>;
  listByLearner(learnerId: string): Promise<LearnerState[]>;
}

export interface EventRepository {
  /** Must be idempotent on `idempotencyKey`: returns the existing event if present. */
  append(event: LearningEvent): Promise<{ event: LearningEvent; created: boolean }>;
  findByIdempotencyKey(learnerId: string, key: string): Promise<LearningEvent | null>;
  listByLearner(learnerId: string, limit: number, offset?: number): Promise<LearningEvent[]>;
  listBySession(sessionId: string): Promise<LearningEvent[]>;
  countByLearner(learnerId: string): Promise<number>;
  listSince(learnerId: string, sinceIso: string): Promise<LearningEvent[]>;
}

export interface AssessmentRepository {
  create(assessment: Assessment): Promise<Assessment>;
  update(assessment: Assessment): Promise<Assessment>;
  findById(id: string): Promise<Assessment | null>;
  findByEventId(eventId: string): Promise<Assessment | null>;
  listBySession(sessionId: string): Promise<Assessment[]>;
  listBySubject(learnerId: string, subjectId: string, limit: number): Promise<Assessment[]>;
  listByLearner(learnerId: string, limit: number): Promise<Assessment[]>;
}

export interface SessionRepository {
  create(session: LearningSession): Promise<LearningSession>;
  update(session: LearningSession): Promise<LearningSession>;
  findById(id: string): Promise<LearningSession | null>;
  findByClientToken(learnerId: string, token: string): Promise<LearningSession | null>;
  findResumable(learnerId: string): Promise<LearningSession | null>;
  listByLearner(
    learnerId: string,
    limit: number,
    statuses?: SessionStatus[],
  ): Promise<LearningSession[]>;
  listRecentActivityTypes(learnerId: string, limit: number): Promise<ActivityType[]>;
}

export interface SessionStartRepository {
  commit(input: {
    session: LearningSession;
    activities: LearningActivity[];
    events: LearningEvent[];
    recommendationId: string | null;
  }): Promise<{ session: LearningSession; activities: LearningActivity[]; created: boolean } | null>;
}

export interface ActivityRepository {
  createMany(activities: LearningActivity[]): Promise<LearningActivity[]>;
  update(activity: LearningActivity): Promise<LearningActivity>;
  findById(id: string): Promise<LearningActivity | null>;
  listBySession(sessionId: string): Promise<LearningActivity[]>;
  findNextPending(sessionId: string): Promise<LearningActivity | null>;
}

export interface ChatMessageRepository {
  create(message: ChatMessage): Promise<ChatMessage>;
  listBySession(sessionId: string, limit?: number): Promise<ChatMessage[]>;
}

export interface MemoryRepository {
  upsertByKey(memory: Memory): Promise<Memory>;
  findByKey(learnerId: string, key: string): Promise<Memory | null>;
  listByLearner(learnerId: string, statuses?: Memory['status'][]): Promise<Memory[]>;
  retire(id: string, updatedAt: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface PreferenceRepository {
  upsertByKey(preference: LearningPreference): Promise<LearningPreference>;
  findByKey(learnerId: string, key: string): Promise<LearningPreference | null>;
  listByLearner(learnerId: string): Promise<LearningPreference[]>;
  delete(id: string): Promise<void>;
}

export interface UserContextRepository {
  create(context: UserContext): Promise<UserContext>;
  findLatest(learnerId: string): Promise<UserContext | null>;
  listByLearner(learnerId: string, limit: number): Promise<UserContext[]>;
}

export interface RecommendationRepository {
  createMany(recommendations: Recommendation[]): Promise<Recommendation[]>;
  update(recommendation: Recommendation): Promise<Recommendation>;
  findById(id: string): Promise<Recommendation | null>;
  listRecent(learnerId: string, limit: number): Promise<Recommendation[]>;
  expireOffered(learnerId: string, beforeIso: string): Promise<void>;
}

export interface TransferEvidenceRepository {
  create(evidence: TransferEvidence): Promise<TransferEvidence>;
  listByLearner(learnerId: string, limit: number): Promise<TransferEvidence[]>;
  listBySubject(learnerId: string, subjectId: string): Promise<TransferEvidence[]>;
}

export interface ContentRepository {
  createSource(source: ContentSource): Promise<ContentSource>;
  findSourceById(id: string): Promise<ContentSource | null>;
  createContent(content: Content): Promise<Content>;
  listContentBySource(sourceId: string): Promise<Content[]>;
  listSourcesByLearner(learnerId: string, limit: number): Promise<ContentSource[]>;
}

// ── v0.2 repositories ─────────────────────────────────────────────────────────

export interface WordlistRepository {
  create(wordlist: Wordlist): Promise<Wordlist>;
  update(wordlist: Wordlist): Promise<Wordlist>;
  findById(id: string): Promise<Wordlist | null>;
  listByLearner(learnerId: string): Promise<Wordlist[]>;
  delete(id: string): Promise<void>;
}

export interface ImportExportHistoryRepository {
  create(record: ImportExportHistory): Promise<ImportExportHistory>;
  update(record: ImportExportHistory): Promise<ImportExportHistory>;
  findById(id: string): Promise<ImportExportHistory | null>;
  /** Idempotency check: has this file hash already been imported by this learner? */
  findByFileHash(learnerId: string, fileHash: string): Promise<ImportExportHistory | null>;
  listByLearner(learnerId: string, limit: number): Promise<ImportExportHistory[]>;
}

export interface KnowledgeOperationLogRepository {
  append(entry: KnowledgeOperationLog): Promise<KnowledgeOperationLog>;
  listByLearner(
    learnerId: string,
    limit: number,
    offset?: number,
    operations?: KnowledgeOperationLog['operation'][],
  ): Promise<KnowledgeOperationLog[]>;
  listByItem(learnerId: string, knowledgeItemId: string, limit: number): Promise<KnowledgeOperationLog[]>;
  countByLearner(learnerId: string): Promise<number>;
}

export interface ScenarioRepository {
  create(scenario: Scenario): Promise<Scenario>;
  update(scenario: Scenario): Promise<Scenario>;
  findById(id: string): Promise<Scenario | null>;
  listByLearner(learnerId: string, statuses?: Scenario['status'][]): Promise<Scenario[]>;
  listByGoal(goalId: string): Promise<Scenario[]>;
  /** Archives scenarios whose resolvedDueAt has passed. Returns the count archived. */
  archiveExpired(learnerId: string, nowIso: string): Promise<number>;
  delete(id: string): Promise<void>;
}

// ── v0.4 repositories ─────────────────────────────────────────────────────────

export interface PlacementRepository {
  create(placement: Placement): Promise<Placement>;
  /** Latest placement for a learner (most recent first, capped by the caller). */
  listByLearner(learnerId: string, limit: number): Promise<Placement[]>;
  findLatest(learnerId: string): Promise<Placement | null>;
}

export interface GoalPhaseRepository {
  createMany(phases: GoalPhase[]): Promise<GoalPhase[]>;
  update(phase: GoalPhase): Promise<GoalPhase>;
  listByGoal(goalId: string): Promise<GoalPhase[]>;
  findById(id: string): Promise<GoalPhase | null>;
  findActiveByGoal(goalId: string): Promise<GoalPhase | null>;
}

export interface WordRelationRepository {
  /** Upsert is idempotent on the deterministic primary key. */
  upsert(relation: WordRelation): Promise<WordRelation>;
  /** Bulk idempotent upsert for the offline import script. */
  upsertMany(relations: WordRelation[]): Promise<WordRelation[]>;
  listByLemma(wordLemma: string): Promise<WordRelation[]>;
  /** Relations for a batch of lemmas (card labels / clustering). */
  listByLemmas(wordLemmas: string[]): Promise<WordRelation[]>;
  /** Topic relations (`relationType='topic'`) for one topic label. */
  listByTopic(topic: string): Promise<WordRelation[]>;
  count(): Promise<number>;
}

export interface FileImportBatch {
  wordlist: Wordlist;
  history: ImportExportHistory;
  items: KnowledgeItem[];
  states: LearnerState[];
  logs: KnowledgeOperationLog[];
  /** Existing items whose empty fields are filled by this import (fill-only). */
  completions: KnowledgeItem[];
  /** Operation-log entries for the fill-only completions. */
  completionLogs: KnowledgeOperationLog[];
}

export interface FileImportCommitResult {
  duplicateFile: boolean;
  history: ImportExportHistory;
  wordlist: Wordlist | null;
  insertedItems: KnowledgeItem[];
  completedCount: number;
}

export interface PoolPromotionBatch {
  learnerId: string;
  itemIds: string[];
  states: LearnerState[];
  logs: KnowledgeOperationLog[];
  event: LearningEvent;
  automaticBudget?: { dayKey: string; budget: number };
}

export interface KnowledgePoolRepository {
  /** Atomically promotes only items still in the pool and writes state/log/event. */
  promote(batch: PoolPromotionBatch): Promise<KnowledgeItem[]>;
  /** Atomically moves active items to the pool and removes them from due scheduling. */
  pause(input: {
    learnerId: string;
    itemIds: string[];
    nowIso: string;
    logs: KnowledgeOperationLog[];
  }): Promise<KnowledgeItem[]>;
}

/** Atomic persistence boundary for one file import. */
export interface FileImportRepository {
  commit(batch: FileImportBatch): Promise<FileImportCommitResult>;
}

export interface LearnerDataSnapshot {
  user: unknown;
  goals: unknown[];
  learningTargets: unknown[];
  knowledgeItems: unknown[];
  knowledgeRelations: unknown[];
  learnerStates: unknown[];
  learningSessions: unknown[];
  learningActivities: unknown[];
  assessments: unknown[];
  learningEvents: unknown[];
  chatMessages: unknown[];
  memories: unknown[];
  preferences: unknown[];
  userContexts: unknown[];
  recommendations: unknown[];
  transferEvidence: unknown[];
  contentSources: unknown[];
  contents: unknown[];
  wordlists: unknown[];
  importExportHistory: unknown[];
  knowledgeOperationLog: unknown[];
  scenarios: unknown[];
  placements: unknown[];
  goalPhases: unknown[];
}

export interface LearnerDataExportRepository {
  /** Returns every row for the learner without silent pagination limits. */
  exportAll(learnerId: string): Promise<LearnerDataSnapshot>;
}

/** Whole-unit-of-work handle passed to application services. */
export interface Repositories {
  users: UserRepository;
  goals: GoalRepository;
  targets: LearningTargetRepository;
  knowledge: KnowledgeRepository;
  relations: KnowledgeRelationRepository;
  states: LearnerStateRepository;
  events: EventRepository;
  assessments: AssessmentRepository;
  sessions: SessionRepository;
  sessionStarts: SessionStartRepository;
  activities: ActivityRepository;
  chat: ChatMessageRepository;
  memories: MemoryRepository;
  preferences: PreferenceRepository;
  contexts: UserContextRepository;
  recommendations: RecommendationRepository;
  transfer: TransferEvidenceRepository;
  content: ContentRepository;
  // v0.2
  wordlists: WordlistRepository;
  importExportHistory: ImportExportHistoryRepository;
  operationLog: KnowledgeOperationLogRepository;
  scenarios: ScenarioRepository;
  fileImports: FileImportRepository;
  knowledgePool: KnowledgePoolRepository;
  dataExport: LearnerDataExportRepository;
  // v0.4
  placements: PlacementRepository;
  goalPhases: GoalPhaseRepository;
  wordRelations: WordRelationRepository;
  /** Deletes every row belonging to a learner (data deletion feature). */
  deleteAllForLearner(learnerId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// AI providers (abstract; no vendor SDK anywhere in domain)
// ---------------------------------------------------------------------------

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Abort signal so the UI can cancel long requests. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmCompletionResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
}

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

export interface SttProvider {
  readonly name: string;
  isConfigured(): boolean;
  transcribe(audio: Uint8Array, languageCode: string): Promise<{ text: string }>;
}

export interface TtsProvider {
  readonly name: string;
  isConfigured(): boolean;
  synthesize(text: string, languageCode: string): Promise<{ audio: Uint8Array; mimeType: string }>;
}

export interface EmbeddingProvider {
  readonly name: string;
  isConfigured(): boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export interface TelemetrySink {
  record(entry: {
    kind: string;
    at: string;
    latencyMs?: number;
    ok: boolean;
    detail?: Record<string, unknown>;
  }): void;
}
