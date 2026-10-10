import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lte, or, sql } from 'drizzle-orm';
import type {
  Assessment,
  ChatMessage,
  Content,
  ContentSource,
  Goal,
  GoalPhase,
  KnowledgeItem,
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
  TransferEvidence,
  User,
  UserContext,
  WordRelation,
} from '@/domain/entities';
import type {
  ActivityType,
  KnowledgeRelationType,
  KnowledgeType,
  SessionStatus,
  SubjectType,
} from '@/domain/enums';
import type {
  ActivityRepository,
  AssessmentRepository,
  ChatMessageRepository,
  ContentRepository,
  EventRepository,
  FileImportRepository,
  GoalPhaseRepository,
  GoalRepository,
  ImportExportHistoryRepository,
  KnowledgeOperationLogRepository,
  KnowledgePoolRepository,
  KnowledgeRelationRepository,
  KnowledgeRepository,
  KnowledgeSearchQuery,
  LearnerDataExportRepository,
  LearnerStateRepository,
  LearningTargetRepository,
  MemoryRepository,
  PlacementRepository,
  PreferenceRepository,
  RecommendationRepository,
  Repositories,
  ScenarioRepository,
  SessionRepository,
  SessionStartRepository,
  TransferEvidenceRepository,
  UserContextRepository,
  UserRepository,
  WordlistRepository,
  WordRelationRepository,
} from '@/domain/ports';
import type { Db } from '../db/client';
import {
  toActivity,
  toAssessment,
  toChatMessage,
  toContent,
  toContentSource,
  toEvent,
  toGoal,
  toGoalPhase,
  toImportExportHistory,
  toKnowledgeItem,
  toKnowledgeOperationLog,
  toLearnerState,
  toMemory,
  toPlacement,
  toPreference,
  toRecommendation,
  toRelation,
  toScenario,
  toSession,
  toTarget,
  toTransferEvidence,
  toUser,
  toUserContext,
  toWordlist,
  toWordRelation,
} from '../db/mappers';
import * as t from '../db/schema';

/** Escapes LIKE wildcards in user-supplied search text. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function first<T>(rows: T[]): T | null {
  return rows.length > 0 ? (rows[0] as T) : null;
}

export function createSqliteRepositories(db: Db): Repositories {
  const users: UserRepository = {
    async findById(id) {
      return first((await db.select().from(t.users).where(eq(t.users.id, id)).limit(1)).map(toUser));
    },
    async upsert(user: User) {
      await db
        .insert(t.users)
        .values(user)
        .onConflictDoUpdate({
          target: t.users.id,
          set: {
            displayName: user.displayName,
            nativeLanguage: user.nativeLanguage,
            updatedAt: user.updatedAt,
          },
        });
      return user;
    },
  };

  const goals: GoalRepository = {
    async create(goal: Goal) {
      await db.insert(t.goals).values(goal);
      return goal;
    },
    async createAsPrimary(goal: Goal) {
      db.transaction((tx) => {
        tx.update(t.goals)
          .set({ isPrimary: false, priority: 2 })
          .where(eq(t.goals.learnerId, goal.learnerId))
          .run();
        tx.insert(t.goals).values({ ...goal, isPrimary: true, priority: 1 }).run();
      });
      return { ...goal, isPrimary: true, priority: 1 };
    },
    async update(goal: Goal) {
      await db.update(t.goals).set(goal).where(eq(t.goals.id, goal.id));
      return goal;
    },
    async setPrimary(goal: Goal) {
      db.transaction((tx) => {
        tx.update(t.goals)
          .set({ isPrimary: false, priority: 2 })
          .where(eq(t.goals.learnerId, goal.learnerId))
          .run();
        tx.update(t.goals)
          .set({ ...goal, isPrimary: true, priority: 1, status: 'active' })
          .where(and(eq(t.goals.id, goal.id), eq(t.goals.learnerId, goal.learnerId)))
          .run();
      });
      return { ...goal, isPrimary: true, priority: 1, status: 'active' };
    },
    async findById(id) {
      return first((await db.select().from(t.goals).where(eq(t.goals.id, id)).limit(1)).map(toGoal));
    },
    async listByLearner(learnerId, statuses) {
      const where =
        statuses && statuses.length > 0
          ? and(eq(t.goals.learnerId, learnerId), inArray(t.goals.status, statuses))
          : eq(t.goals.learnerId, learnerId);
      const rows = await db
        .select()
        .from(t.goals)
        .where(where)
        .orderBy(desc(t.goals.isPrimary), asc(t.goals.priority), desc(t.goals.createdAt));
      return rows.map(toGoal);
    },
    async findPrimary(learnerId) {
      const rows = await db
        .select()
        .from(t.goals)
        .where(
          and(
            eq(t.goals.learnerId, learnerId),
            eq(t.goals.status, 'active'),
            eq(t.goals.isPrimary, true),
          ),
        )
        .limit(1);
      if (rows.length > 0) return toGoal(rows[0]!);
      // Fall back to the highest-priority active goal.
      const fallback = await db
        .select()
        .from(t.goals)
        .where(and(eq(t.goals.learnerId, learnerId), eq(t.goals.status, 'active')))
        .orderBy(asc(t.goals.priority), desc(t.goals.createdAt))
        .limit(1);
      return fallback.length > 0 ? toGoal(fallback[0]!) : null;
    },
    async clearPrimary(learnerId) {
      await db
        .update(t.goals)
        .set({ isPrimary: false, priority: 2 })
        .where(eq(t.goals.learnerId, learnerId));
    },
    async findLatestByRawInput(learnerId, rawInput) {
      const rows = await db
        .select()
        .from(t.goals)
        .where(and(eq(t.goals.learnerId, learnerId), eq(t.goals.rawInput, rawInput)))
        .orderBy(desc(t.goals.createdAt))
        .limit(1);
      return rows.length > 0 ? toGoal(rows[0]!) : null;
    },
  };

  const targets: LearningTargetRepository = {
    async createMany(list: LearningTarget[]) {
      if (list.length === 0) return [];
      await db.insert(t.learningTargets).values(list).onConflictDoNothing();
      return list;
    },
    async update(target) {
      await db
        .update(t.learningTargets)
        .set(target)
        .where(eq(t.learningTargets.id, target.id));
      return target;
    },
    async listByGoal(goalId) {
      const rows = await db
        .select()
        .from(t.learningTargets)
        .where(eq(t.learningTargets.goalId, goalId))
        .orderBy(desc(t.learningTargets.importance));
      return rows.map(toTarget);
    },
    async listByLearner(learnerId) {
      const rows = await db
        .select()
        .from(t.learningTargets)
        .where(eq(t.learningTargets.learnerId, learnerId))
        .orderBy(desc(t.learningTargets.importance));
      return rows.map(toTarget);
    },
    async deleteByGoal(goalId) {
      await db.delete(t.learningTargets).where(eq(t.learningTargets.goalId, goalId));
    },
  };

  const knowledgeWhere = (query: KnowledgeSearchQuery) => {
    const conditions = [eq(t.knowledgeItems.learnerId, query.learnerId)];
    if (query.statuses && query.statuses.length > 0) {
      conditions.push(inArray(t.knowledgeItems.status, query.statuses));
    }
    if (query.types && query.types.length > 0) {
      conditions.push(inArray(t.knowledgeItems.type, query.types));
    }
    if (query.text && query.text.trim().length > 0) {
      const pattern = `%${escapeLike(query.text.trim().toLowerCase())}%`;
      const textMatch = or(
        like(sql`lower(${t.knowledgeItems.text})`, pattern),
        like(t.knowledgeItems.normalizedText, pattern),
        like(sql`lower(coalesce(${t.knowledgeItems.meaning}, ''))`, pattern),
      );
      if (textMatch) conditions.push(textMatch);
    }
    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        conditions.push(like(t.knowledgeItems.tags, `%"${escapeLike(tag)}"%`));
      }
    }
    if (query.wordlistIds && query.wordlistIds.length > 0) {
      conditions.push(inArray(t.knowledgeItems.wordlistId, query.wordlistIds));
    }
    return and(...conditions);
  };

  const knowledge: KnowledgeRepository = {
    async create(item: KnowledgeItem) {
      await db.insert(t.knowledgeItems).values(item);
      return item;
    },
    async update(item: KnowledgeItem) {
      await db.update(t.knowledgeItems).set(item).where(eq(t.knowledgeItems.id, item.id));
      return item;
    },
    async delete(id) {
      await db.delete(t.knowledgeItems).where(eq(t.knowledgeItems.id, id));
      await db
        .delete(t.knowledgeRelations)
        .where(
          or(eq(t.knowledgeRelations.fromItemId, id), eq(t.knowledgeRelations.toItemId, id)),
        );
    },
    async findById(id) {
      return first(
        (
          await db.select().from(t.knowledgeItems).where(eq(t.knowledgeItems.id, id)).limit(1)
        ).map(toKnowledgeItem),
      );
    },
    async findByNormalized(learnerId, languageCode, type: KnowledgeType, normalizedText) {
      const rows = await db
        .select()
        .from(t.knowledgeItems)
        .where(
          and(
            eq(t.knowledgeItems.learnerId, learnerId),
            eq(t.knowledgeItems.languageCode, languageCode),
            eq(t.knowledgeItems.type, type),
            eq(t.knowledgeItems.normalizedText, normalizedText),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toKnowledgeItem(rows[0]!) : null;
    },
    async findAnyByNormalized(learnerId, languageCode, normalizedText) {
      const rows = await db
        .select()
        .from(t.knowledgeItems)
        .where(
          and(
            eq(t.knowledgeItems.learnerId, learnerId),
            eq(t.knowledgeItems.languageCode, languageCode),
            eq(t.knowledgeItems.normalizedText, normalizedText),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toKnowledgeItem(rows[0]!) : null;
    },
    async listNormalizedByLanguage(learnerId, languageCode) {
      const rows = await db
        .select({ normalizedText: t.knowledgeItems.normalizedText })
        .from(t.knowledgeItems)
        .where(
          and(
            eq(t.knowledgeItems.learnerId, learnerId),
            eq(t.knowledgeItems.languageCode, languageCode),
          ),
        );
      return rows.map((row) => row.normalizedText);
    },
    async listByNormalizedTexts(learnerId, languageCode, normalizedTexts) {
      const unique = [...new Set(normalizedTexts)];
      if (unique.length === 0) return [];
      const rows = await db
        .select()
        .from(t.knowledgeItems)
        .where(
          and(
            eq(t.knowledgeItems.learnerId, learnerId),
            eq(t.knowledgeItems.languageCode, languageCode),
            inArray(t.knowledgeItems.normalizedText, unique),
          ),
        );
      return rows.map(toKnowledgeItem);
    },
    async search(query) {
      const rows = await db
        .select()
        .from(t.knowledgeItems)
        .where(knowledgeWhere(query))
        .orderBy(desc(t.knowledgeItems.updatedAt), asc(t.knowledgeItems.id))
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0);
      return rows.map(toKnowledgeItem);
    },
    async count(query) {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(t.knowledgeItems)
        .where(knowledgeWhere(query));
      return rows[0]?.value ?? 0;
    },
    async listByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(t.knowledgeItems)
        .where(inArray(t.knowledgeItems.id, ids));
      return rows.map(toKnowledgeItem);
    },
  };

  const relations: KnowledgeRelationRepository = {
    async create(relation: KnowledgeRelation) {
      await db.insert(t.knowledgeRelations).values(relation).onConflictDoNothing();
      return relation;
    },
    async delete(id) {
      await db.delete(t.knowledgeRelations).where(eq(t.knowledgeRelations.id, id));
    },
    async listByItem(itemId) {
      const rows = await db
        .select()
        .from(t.knowledgeRelations)
        .where(
          or(
            eq(t.knowledgeRelations.fromItemId, itemId),
            eq(t.knowledgeRelations.toItemId, itemId),
          ),
        );
      return rows.map(toRelation);
    },
    async find(fromItemId, toItemId, type: KnowledgeRelationType) {
      const rows = await db
        .select()
        .from(t.knowledgeRelations)
        .where(
          and(
            eq(t.knowledgeRelations.fromItemId, fromItemId),
            eq(t.knowledgeRelations.toItemId, toItemId),
            eq(t.knowledgeRelations.type, type),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toRelation(rows[0]!) : null;
    },
    async listByLearner(learnerId) {
      const rows = await db
        .select()
        .from(t.knowledgeRelations)
        .where(eq(t.knowledgeRelations.learnerId, learnerId));
      return rows.map(toRelation);
    },
  };

  const states: LearnerStateRepository = {
    async find(learnerId, subjectType: SubjectType, subjectId) {
      const rows = await db
        .select()
        .from(t.learnerStates)
        .where(
          and(
            eq(t.learnerStates.learnerId, learnerId),
            eq(t.learnerStates.subjectType, subjectType),
            eq(t.learnerStates.subjectId, subjectId),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toLearnerState(rows[0]!) : null;
    },
    async upsert(state: LearnerState) {
      await db
        .insert(t.learnerStates)
        .values(state)
        .onConflictDoUpdate({
          target: [
            t.learnerStates.learnerId,
            t.learnerStates.subjectType,
            t.learnerStates.subjectId,
          ],
          set: {
            mastery: state.mastery,
            confidence: state.confidence,
            exposureCount: state.exposureCount,
            successfulAttempts: state.successfulAttempts,
            failedAttempts: state.failedAttempts,
            recentPerformance: state.recentPerformance,
            historicalPerformance: state.historicalPerformance,
            stabilityDays: state.stabilityDays,
            easeFactor: state.easeFactor,
            repetitions: state.repetitions,
            retrievalStrength: state.retrievalStrength,
            modalityStats: state.modalityStats,
            recentEvidence: state.recentEvidence,
            transferScore: state.transferScore,
            transferConfidence: state.transferConfidence,
            trend: state.trend,
            lastPracticedAt: state.lastPracticedAt,
            nextReviewAt: state.nextReviewAt,
            userDeclaredMastered: state.userDeclaredMastered,
            updatedAt: state.updatedAt,
          },
        });
      return state;
    },
    async listBySubjectType(learnerId, subjectType) {
      const rows = await db
        .select()
        .from(t.learnerStates)
        .where(
          and(
            eq(t.learnerStates.learnerId, learnerId),
            eq(t.learnerStates.subjectType, subjectType),
          ),
        );
      return rows.map(toLearnerState);
    },
    async listBySubjectIds(learnerId, subjectType, subjectIds) {
      if (subjectIds.length === 0) return [];
      const rows = await db
        .select()
        .from(t.learnerStates)
        .where(
          and(
            eq(t.learnerStates.learnerId, learnerId),
            eq(t.learnerStates.subjectType, subjectType),
            inArray(t.learnerStates.subjectId, subjectIds),
          ),
        );
      return rows.map(toLearnerState);
    },
    async listDueForReview(learnerId, nowIso, limit) {
      const rows = await db
        .select()
        .from(t.learnerStates)
        .where(
          and(
            eq(t.learnerStates.learnerId, learnerId),
            eq(t.learnerStates.subjectType, 'knowledge_item'),
            isNotNull(t.learnerStates.nextReviewAt),
            lte(t.learnerStates.nextReviewAt, nowIso),
          ),
        )
        .orderBy(asc(t.learnerStates.nextReviewAt))
        .limit(limit);
      return rows.map(toLearnerState);
    },
    async listWeakest(learnerId, subjectType, limit) {
      const rows = await db
        .select()
        .from(t.learnerStates)
        .where(
          and(
            eq(t.learnerStates.learnerId, learnerId),
            eq(t.learnerStates.subjectType, subjectType),
          ),
        )
        .orderBy(asc(t.learnerStates.mastery))
        .limit(limit);
      return rows.map(toLearnerState);
    },
    async listByLearner(learnerId) {
      const rows = await db
        .select()
        .from(t.learnerStates)
        .where(eq(t.learnerStates.learnerId, learnerId));
      return rows.map(toLearnerState);
    },
  };

  const events: EventRepository = {
    async append(event: LearningEvent) {
      const existing = await db
        .select()
        .from(t.learningEvents)
        .where(
          and(
            eq(t.learningEvents.learnerId, event.learnerId),
            eq(t.learningEvents.idempotencyKey, event.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return { event: toEvent(existing[0]!), created: false };
      }
      try {
        await db.insert(t.learningEvents).values(event);
        return { event, created: true };
      } catch (error) {
        // Unique index on (learner_id, idempotency_key) — concurrent duplicate.
        const retry = await db
          .select()
          .from(t.learningEvents)
          .where(
            and(
              eq(t.learningEvents.learnerId, event.learnerId),
              eq(t.learningEvents.idempotencyKey, event.idempotencyKey),
            ),
          )
          .limit(1);
        if (retry.length > 0) return { event: toEvent(retry[0]!), created: false };
        throw error;
      }
    },
    async findByIdempotencyKey(learnerId, key) {
      const rows = await db
        .select()
        .from(t.learningEvents)
        .where(
          and(
            eq(t.learningEvents.learnerId, learnerId),
            eq(t.learningEvents.idempotencyKey, key),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toEvent(rows[0]!) : null;
    },
    async listByLearner(learnerId, limit, offset = 0) {
      const rows = await db
        .select()
        .from(t.learningEvents)
        .where(eq(t.learningEvents.learnerId, learnerId))
        .orderBy(desc(t.learningEvents.occurredAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toEvent);
    },
    async listBySession(sessionId) {
      const rows = await db
        .select()
        .from(t.learningEvents)
        .where(eq(t.learningEvents.sessionId, sessionId))
        .orderBy(asc(t.learningEvents.occurredAt));
      return rows.map(toEvent);
    },
    async countByLearner(learnerId) {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(t.learningEvents)
        .where(eq(t.learningEvents.learnerId, learnerId));
      return rows[0]?.value ?? 0;
    },
    async listSince(learnerId, sinceIso) {
      const rows = await db
        .select()
        .from(t.learningEvents)
        .where(
          and(
            eq(t.learningEvents.learnerId, learnerId),
            sql`${t.learningEvents.occurredAt} >= ${sinceIso}`,
          ),
        )
        .orderBy(desc(t.learningEvents.occurredAt));
      return rows.map(toEvent);
    },
  };

  const assessmentsRepo: AssessmentRepository = {
    async create(assessment: Assessment) {
      await db.insert(t.assessments).values(assessment).onConflictDoNothing();
      return assessment;
    },
    async update(assessment: Assessment) {
      await db
        .update(t.assessments)
        .set(assessment)
        .where(eq(t.assessments.id, assessment.id));
      return assessment;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(t.assessments)
        .where(eq(t.assessments.id, id))
        .limit(1);
      return rows.length > 0 ? toAssessment(rows[0]!) : null;
    },
    async findByEventId(eventId) {
      const rows = await db
        .select()
        .from(t.assessments)
        .where(eq(t.assessments.eventId, eventId))
        .limit(1);
      return rows.length > 0 ? toAssessment(rows[0]!) : null;
    },
    async listBySession(sessionId) {
      const rows = await db
        .select()
        .from(t.assessments)
        .where(eq(t.assessments.sessionId, sessionId))
        .orderBy(asc(t.assessments.occurredAt));
      return rows.map(toAssessment);
    },
    async listBySubject(learnerId, subjectId, limit) {
      const rows = await db
        .select()
        .from(t.assessments)
        .where(
          and(eq(t.assessments.learnerId, learnerId), eq(t.assessments.subjectId, subjectId)),
        )
        .orderBy(desc(t.assessments.occurredAt))
        .limit(limit);
      return rows.map(toAssessment);
    },
    async listByLearner(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.assessments)
        .where(eq(t.assessments.learnerId, learnerId))
        .orderBy(desc(t.assessments.occurredAt))
        .limit(limit);
      return rows.map(toAssessment);
    },
  };

  const sessions: SessionRepository = {
    async create(session: LearningSession) {
      await db.insert(t.learningSessions).values(session);
      return session;
    },
    async update(session: LearningSession) {
      await db
        .update(t.learningSessions)
        .set(session)
        .where(eq(t.learningSessions.id, session.id));
      return session;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(t.learningSessions)
        .where(eq(t.learningSessions.id, id))
        .limit(1);
      return rows.length > 0 ? toSession(rows[0]!) : null;
    },
    async findByClientToken(learnerId, token) {
      const rows = await db
        .select()
        .from(t.learningSessions)
        .where(
          and(
            eq(t.learningSessions.learnerId, learnerId),
            eq(t.learningSessions.clientToken, token),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toSession(rows[0]!) : null;
    },
    async findResumable(learnerId) {
      const rows = await db
        .select()
        .from(t.learningSessions)
        .where(
          and(
            eq(t.learningSessions.learnerId, learnerId),
            inArray(t.learningSessions.status, ['created', 'active', 'paused']),
          ),
        )
        .orderBy(desc(t.learningSessions.updatedAt))
        .limit(1);
      return rows.length > 0 ? toSession(rows[0]!) : null;
    },
    async listByLearner(learnerId, limit, statuses?: SessionStatus[]) {
      const where =
        statuses && statuses.length > 0
          ? and(
              eq(t.learningSessions.learnerId, learnerId),
              inArray(t.learningSessions.status, statuses),
            )
          : eq(t.learningSessions.learnerId, learnerId);
      const rows = await db
        .select()
        .from(t.learningSessions)
        .where(where)
        .orderBy(desc(t.learningSessions.createdAt))
        .limit(limit);
      return rows.map(toSession);
    },
    async listRecentActivityTypes(learnerId, limit) {
      const rows = await db
        .select({ activityType: t.learningSessions.activityType })
        .from(t.learningSessions)
        .where(eq(t.learningSessions.learnerId, learnerId))
        .orderBy(desc(t.learningSessions.createdAt))
        .limit(limit);
      return rows.map((row) => row.activityType as ActivityType);
    },
  };

  const activities: ActivityRepository = {
    async createMany(list: LearningActivity[]) {
      if (list.length === 0) return [];
      await db.insert(t.learningActivities).values(list).onConflictDoNothing();
      return list;
    },
    async update(activity) {
      await db
        .update(t.learningActivities)
        .set(activity)
        .where(eq(t.learningActivities.id, activity.id));
      return activity;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(t.learningActivities)
        .where(eq(t.learningActivities.id, id))
        .limit(1);
      return rows.length > 0 ? toActivity(rows[0]!) : null;
    },
    async listBySession(sessionId) {
      const rows = await db
        .select()
        .from(t.learningActivities)
        .where(eq(t.learningActivities.sessionId, sessionId))
        .orderBy(asc(t.learningActivities.position));
      return rows.map(toActivity);
    },
    async findNextPending(sessionId) {
      const rows = await db
        .select()
        .from(t.learningActivities)
        .where(
          and(
            eq(t.learningActivities.sessionId, sessionId),
            eq(t.learningActivities.status, 'pending'),
          ),
        )
        .orderBy(asc(t.learningActivities.position))
        .limit(1);
      return rows.length > 0 ? toActivity(rows[0]!) : null;
    },
  };

  const chat: ChatMessageRepository = {
    async create(message: ChatMessage) {
      await db.insert(t.chatMessages).values(message);
      return message;
    },
    async listBySession(sessionId, limit = 200) {
      const rows = await db
        .select()
        .from(t.chatMessages)
        .where(eq(t.chatMessages.sessionId, sessionId))
        .orderBy(asc(t.chatMessages.createdAt))
        .limit(limit);
      return rows.map(toChatMessage);
    },
  };

  const memoriesRepo: MemoryRepository = {
    async upsertByKey(memory: Memory) {
      await db
        .insert(t.memories)
        .values(memory)
        .onConflictDoUpdate({
          target: [t.memories.learnerId, t.memories.key],
          set: {
            content: memory.content,
            confidence: memory.confidence,
            evidenceCount: memory.evidenceCount,
            lastObservedAt: memory.lastObservedAt,
            status: memory.status,
            kind: memory.kind,
            updatedAt: memory.updatedAt,
          },
        });
      return memory;
    },
    async findByKey(learnerId, key) {
      const rows = await db
        .select()
        .from(t.memories)
        .where(and(eq(t.memories.learnerId, learnerId), eq(t.memories.key, key)))
        .limit(1);
      return rows.length > 0 ? toMemory(rows[0]!) : null;
    },
    async listByLearner(learnerId, statuses) {
      const where =
        statuses && statuses.length > 0
          ? and(eq(t.memories.learnerId, learnerId), inArray(t.memories.status, statuses))
          : eq(t.memories.learnerId, learnerId);
      const rows = await db
        .select()
        .from(t.memories)
        .where(where)
        .orderBy(desc(t.memories.confidence), desc(t.memories.lastObservedAt));
      return rows.map(toMemory);
    },
    async retire(id, updatedAt) {
      await db
        .update(t.memories)
        .set({ status: 'retired', updatedAt })
        .where(eq(t.memories.id, id));
    },
    async delete(id) {
      await db.delete(t.memories).where(eq(t.memories.id, id));
    },
  };

  const preferences: PreferenceRepository = {
    async upsertByKey(preference: LearningPreference) {
      await db
        .insert(t.learningPreferences)
        .values(preference)
        .onConflictDoUpdate({
          target: [t.learningPreferences.learnerId, t.learningPreferences.key],
          set: {
            value: preference.value,
            confidence: preference.confidence,
            evidenceCount: preference.evidenceCount,
            source: preference.source,
            lastObservedAt: preference.lastObservedAt,
            updatedAt: preference.updatedAt,
          },
        });
      return preference;
    },
    async findByKey(learnerId, key) {
      const rows = await db
        .select()
        .from(t.learningPreferences)
        .where(
          and(
            eq(t.learningPreferences.learnerId, learnerId),
            eq(t.learningPreferences.key, key),
          ),
        )
        .limit(1);
      return rows.length > 0 ? toPreference(rows[0]!) : null;
    },
    async listByLearner(learnerId) {
      const rows = await db
        .select()
        .from(t.learningPreferences)
        .where(eq(t.learningPreferences.learnerId, learnerId))
        .orderBy(desc(t.learningPreferences.confidence));
      return rows.map(toPreference);
    },
    async delete(id) {
      await db.delete(t.learningPreferences).where(eq(t.learningPreferences.id, id));
    },
  };

  const contexts: UserContextRepository = {
    async create(context: UserContext) {
      await db.insert(t.userContexts).values(context);
      return context;
    },
    async findLatest(learnerId) {
      const rows = await db
        .select()
        .from(t.userContexts)
        .where(eq(t.userContexts.learnerId, learnerId))
        .orderBy(desc(t.userContexts.capturedAt))
        .limit(1);
      return rows.length > 0 ? toUserContext(rows[0]!) : null;
    },
    async listByLearner(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.userContexts)
        .where(eq(t.userContexts.learnerId, learnerId))
        .orderBy(desc(t.userContexts.capturedAt))
        .limit(limit);
      return rows.map(toUserContext);
    },
  };

  const recommendationsRepo: RecommendationRepository = {
    async createMany(list: Recommendation[]) {
      if (list.length === 0) return [];
      await db.insert(t.recommendations).values(list);
      return list;
    },
    async update(recommendation) {
      await db
        .update(t.recommendations)
        .set(recommendation)
        .where(eq(t.recommendations.id, recommendation.id));
      return recommendation;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(t.recommendations)
        .where(eq(t.recommendations.id, id))
        .limit(1);
      return rows.length > 0 ? toRecommendation(rows[0]!) : null;
    },
    async listRecent(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.recommendations)
        .where(eq(t.recommendations.learnerId, learnerId))
        .orderBy(desc(t.recommendations.generatedAt))
        .limit(limit);
      return rows.map(toRecommendation);
    },
    async expireOffered(learnerId, beforeIso) {
      await db
        .update(t.recommendations)
        .set({ status: 'expired' })
        .where(
          and(
            eq(t.recommendations.learnerId, learnerId),
            eq(t.recommendations.status, 'offered'),
            sql`${t.recommendations.generatedAt} < ${beforeIso}`,
          ),
        );
    },
  };

  const transfer: TransferEvidenceRepository = {
    async create(evidence: TransferEvidence) {
      await db.insert(t.transferEvidences).values(evidence);
      return evidence;
    },
    async listByLearner(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.transferEvidences)
        .where(eq(t.transferEvidences.learnerId, learnerId))
        .orderBy(desc(t.transferEvidences.occurredAt))
        .limit(limit);
      return rows.map(toTransferEvidence);
    },
    async listBySubject(learnerId, subjectId) {
      const rows = await db
        .select()
        .from(t.transferEvidences)
        .where(
          and(
            eq(t.transferEvidences.learnerId, learnerId),
            eq(t.transferEvidences.subjectId, subjectId),
          ),
        )
        .orderBy(desc(t.transferEvidences.occurredAt));
      return rows.map(toTransferEvidence);
    },
  };

  const content: ContentRepository = {
    async createSource(source: ContentSource) {
      await db.insert(t.contentSources).values(source);
      return source;
    },
    async findSourceById(id) {
      const rows = await db
        .select()
        .from(t.contentSources)
        .where(eq(t.contentSources.id, id))
        .limit(1);
      return rows.length > 0 ? toContentSource(rows[0]!) : null;
    },
    async createContent(item: Content) {
      await db.insert(t.contents).values(item);
      return item;
    },
    async listContentBySource(sourceId) {
      const rows = await db
        .select()
        .from(t.contents)
        .where(eq(t.contents.sourceId, sourceId))
        .orderBy(asc(t.contents.createdAt));
      return rows.map(toContent);
    },
    async listSourcesByLearner(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.contentSources)
        .where(
          or(eq(t.contentSources.learnerId, learnerId), isNull(t.contentSources.learnerId)),
        )
        .orderBy(desc(t.contentSources.createdAt))
        .limit(limit);
      return rows.map(toContentSource);
    },
  };

  const wordlistsRepo = createWordlistRepository(db);
  const importExportHistoryRepo = createImportExportHistoryRepository(db);
  const operationLogRepo = createKnowledgeOperationLogRepository(db);
  const scenariosRepo = createScenarioRepository(db);
  const fileImportsRepo = createFileImportRepository(db);
  const knowledgePoolRepo = createKnowledgePoolRepository(db);
  const dataExportRepo = createLearnerDataExportRepository(db);
  const sessionStartsRepo = createSessionStartRepository(db);
  const placementsRepo = createPlacementRepository(db);
  const goalPhasesRepo = createGoalPhaseRepository(db);
  const wordRelationsRepo = createWordRelationRepository(db);

  return {
    users,
    goals,
    targets,
    knowledge,
    relations,
    states,
    events,
    assessments: assessmentsRepo,
    sessions,
    sessionStarts: sessionStartsRepo,
    activities,
    chat,
    memories: memoriesRepo,
    preferences,
    contexts,
    recommendations: recommendationsRepo,
    transfer,
    content,
    wordlists: wordlistsRepo,
    importExportHistory: importExportHistoryRepo,
    operationLog: operationLogRepo,
    scenarios: scenariosRepo,
    fileImports: fileImportsRepo,
    knowledgePool: knowledgePoolRepo,
    dataExport: dataExportRepo,
    placements: placementsRepo,
    goalPhases: goalPhasesRepo,
    wordRelations: wordRelationsRepo,
    async deleteAllForLearner(learnerId: string) {
      const goalRows = db
        .select({ id: t.goals.id })
        .from(t.goals)
        .where(eq(t.goals.learnerId, learnerId))
        .all();
      const goalIds = goalRows.map((row) => row.id);
      db.transaction((tx) => {
        tx.delete(t.assessments).where(eq(t.assessments.learnerId, learnerId)).run();
        tx.delete(t.learningEvents).where(eq(t.learningEvents.learnerId, learnerId)).run();
        tx.delete(t.learningActivities)
          .where(eq(t.learningActivities.learnerId, learnerId))
          .run();
        tx.delete(t.chatMessages).where(eq(t.chatMessages.learnerId, learnerId)).run();
        tx.delete(t.learningSessions)
          .where(eq(t.learningSessions.learnerId, learnerId))
          .run();
        tx.delete(t.knowledgeRelations)
          .where(eq(t.knowledgeRelations.learnerId, learnerId))
          .run();
        tx.delete(t.knowledgeItems).where(eq(t.knowledgeItems.learnerId, learnerId)).run();
        tx.delete(t.learnerStates).where(eq(t.learnerStates.learnerId, learnerId)).run();
        tx.delete(t.learningTargets)
          .where(eq(t.learningTargets.learnerId, learnerId))
          .run();
        tx.delete(t.placements).where(eq(t.placements.learnerId, learnerId)).run();
        if (goalIds.length > 0) {
          tx.delete(t.goalPhases).where(inArray(t.goalPhases.goalId, goalIds)).run();
        }
        tx.delete(t.goals).where(eq(t.goals.learnerId, learnerId)).run();
        tx.delete(t.memories).where(eq(t.memories.learnerId, learnerId)).run();
        tx.delete(t.learningPreferences)
          .where(eq(t.learningPreferences.learnerId, learnerId))
          .run();
        tx.delete(t.userContexts).where(eq(t.userContexts.learnerId, learnerId)).run();
        tx.delete(t.recommendations)
          .where(eq(t.recommendations.learnerId, learnerId))
          .run();
        tx.delete(t.transferEvidences)
          .where(eq(t.transferEvidences.learnerId, learnerId))
          .run();
        tx.delete(t.contents).where(eq(t.contents.learnerId, learnerId)).run();
        tx.delete(t.contentSources).where(eq(t.contentSources.learnerId, learnerId)).run();
        tx.delete(t.wordlists).where(eq(t.wordlists.learnerId, learnerId)).run();
        tx.delete(t.importExportHistory)
          .where(eq(t.importExportHistory.learnerId, learnerId))
          .run();
        tx.delete(t.knowledgeOperationLog)
          .where(eq(t.knowledgeOperationLog.learnerId, learnerId))
          .run();
        tx.delete(t.scenarios).where(eq(t.scenarios.learnerId, learnerId)).run();
      });
    },
  };
}

// ── v0.2 repository factory helpers ──────────────────────────────────────────
// These are defined as standalone functions and injected in createSqliteRepositories.

export function createSessionStartRepository(db: Db): SessionStartRepository {
  return {
    async commit(input) {
      return db.transaction((tx) => {
        const existingRows = tx
          .select()
          .from(t.learningSessions)
          .where(
            and(
              eq(t.learningSessions.learnerId, input.session.learnerId),
              eq(t.learningSessions.clientToken, input.session.clientToken!),
            ),
          )
          .limit(1)
          .all();
        if (existingRows[0]) {
          const existing = toSession(existingRows[0]);
          const activities = tx
            .select()
            .from(t.learningActivities)
            .where(eq(t.learningActivities.sessionId, existing.id))
            .orderBy(asc(t.learningActivities.position))
            .all()
            .map(toActivity);
          return { session: existing, activities, created: false };
        }
        if (input.recommendationId) {
          const claimed = tx
            .update(t.recommendations)
            .set({ status: 'accepted' })
            .where(
              and(
                eq(t.recommendations.id, input.recommendationId),
                eq(t.recommendations.learnerId, input.session.learnerId),
                eq(t.recommendations.status, 'offered'),
              ),
            )
            .run();
          if (claimed.changes !== 1) return null;
        }
        tx.insert(t.learningSessions).values(input.session).run();
        if (input.activities.length > 0) {
          tx.insert(t.learningActivities).values(input.activities).run();
        }
        for (const event of input.events) {
          tx.insert(t.learningEvents).values(event).onConflictDoNothing().run();
        }
        return { session: input.session, activities: input.activities, created: true };
      });
    },
  };
}

export function createLearnerDataExportRepository(db: Db): LearnerDataExportRepository {
  return {
    async exportAll(learnerId) {
      const [user] = await db.select().from(t.users).where(eq(t.users.id, learnerId)).limit(1);
      const goalRows = await db
        .select({ id: t.goals.id })
        .from(t.goals)
        .where(eq(t.goals.learnerId, learnerId));
      const goalIds = goalRows.map((row) => row.id);
      return {
        user: user ?? null,
        goals: await db.select().from(t.goals).where(eq(t.goals.learnerId, learnerId)),
        learningTargets: await db.select().from(t.learningTargets).where(eq(t.learningTargets.learnerId, learnerId)),
        knowledgeItems: await db.select().from(t.knowledgeItems).where(eq(t.knowledgeItems.learnerId, learnerId)),
        knowledgeRelations: await db.select().from(t.knowledgeRelations).where(eq(t.knowledgeRelations.learnerId, learnerId)),
        learnerStates: await db.select().from(t.learnerStates).where(eq(t.learnerStates.learnerId, learnerId)),
        learningSessions: await db.select().from(t.learningSessions).where(eq(t.learningSessions.learnerId, learnerId)),
        learningActivities: await db.select().from(t.learningActivities).where(eq(t.learningActivities.learnerId, learnerId)),
        assessments: await db.select().from(t.assessments).where(eq(t.assessments.learnerId, learnerId)),
        learningEvents: await db.select().from(t.learningEvents).where(eq(t.learningEvents.learnerId, learnerId)),
        chatMessages: await db.select().from(t.chatMessages).where(eq(t.chatMessages.learnerId, learnerId)),
        memories: await db.select().from(t.memories).where(eq(t.memories.learnerId, learnerId)),
        preferences: await db.select().from(t.learningPreferences).where(eq(t.learningPreferences.learnerId, learnerId)),
        userContexts: await db.select().from(t.userContexts).where(eq(t.userContexts.learnerId, learnerId)),
        recommendations: await db.select().from(t.recommendations).where(eq(t.recommendations.learnerId, learnerId)),
        transferEvidence: await db.select().from(t.transferEvidences).where(eq(t.transferEvidences.learnerId, learnerId)),
        contentSources: await db
          .select()
          .from(t.contentSources)
          .where(or(eq(t.contentSources.learnerId, learnerId), isNull(t.contentSources.learnerId))),
        contents: await db.select().from(t.contents).where(eq(t.contents.learnerId, learnerId)),
        wordlists: await db.select().from(t.wordlists).where(eq(t.wordlists.learnerId, learnerId)),
        importExportHistory: await db.select().from(t.importExportHistory).where(eq(t.importExportHistory.learnerId, learnerId)),
        knowledgeOperationLog: await db.select().from(t.knowledgeOperationLog).where(eq(t.knowledgeOperationLog.learnerId, learnerId)),
        scenarios: await db.select().from(t.scenarios).where(eq(t.scenarios.learnerId, learnerId)),
        placements: await db.select().from(t.placements).where(eq(t.placements.learnerId, learnerId)),
        goalPhases: goalIds.length > 0
          ? await db.select().from(t.goalPhases).where(inArray(t.goalPhases.goalId, goalIds))
          : [],
      };
    },
  };
}

export function createKnowledgePoolRepository(db: Db): KnowledgePoolRepository {
  return {
    async promote(batch) {
      return db.transaction((tx) => {
        let allowance = batch.itemIds.length;
        if (batch.automaticBudget) {
          const rows = tx
            .select({ payload: t.learningEvents.payload })
            .from(t.learningEvents)
            .where(
              and(
                eq(t.learningEvents.learnerId, batch.learnerId),
                eq(t.learningEvents.type, 'knowledge_pool_promoted'),
              ),
            )
            .all();
          const used = rows.reduce((sum, row) => {
            const payload = row.payload as {
              mode?: string;
              dayKey?: string;
              itemIds?: unknown[];
            };
            return payload.mode === 'automatic' &&
              payload.dayKey === batch.automaticBudget?.dayKey &&
              Array.isArray(payload.itemIds)
              ? sum + payload.itemIds.length
              : sum;
          }, 0);
          allowance = Math.max(0, batch.automaticBudget.budget - used);
        }
        if (allowance === 0 || batch.itemIds.length === 0) return [];

        const rows = tx
          .select()
          .from(t.knowledgeItems)
          .where(
            and(
              eq(t.knowledgeItems.learnerId, batch.learnerId),
              eq(t.knowledgeItems.status, 'new'),
              inArray(t.knowledgeItems.id, batch.itemIds),
            ),
          )
          .all();
        const byId = new Map(rows.map((row) => [row.id, row]));
        const selected = batch.itemIds
          .map((id) => byId.get(id))
          .filter((row): row is NonNullable<typeof row> => row !== undefined)
          .slice(0, allowance);
        if (selected.length === 0) return [];
        const selectedIds = new Set(selected.map((row) => row.id));

        for (const row of selected) {
          tx.update(t.knowledgeItems)
            .set({ status: 'active', updatedAt: batch.event.occurredAt })
            .where(
              and(
                eq(t.knowledgeItems.id, row.id),
                eq(t.knowledgeItems.learnerId, batch.learnerId),
                eq(t.knowledgeItems.status, 'new'),
              ),
            )
            .run();
        }
        const states = batch.states.filter((state) => selectedIds.has(state.subjectId));
        if (states.length > 0) {
          tx.insert(t.learnerStates).values(states).onConflictDoNothing().run();
        }
        const logs = batch.logs.filter(
          (entry) => entry.knowledgeItemId !== null && selectedIds.has(entry.knowledgeItemId),
        );
        if (logs.length > 0) tx.insert(t.knowledgeOperationLog).values(logs).run();
        tx.insert(t.learningEvents)
          .values({
            ...batch.event,
            payload: {
              ...batch.event.payload,
              itemIds: selected.map((row) => row.id),
              count: selected.length,
            },
          })
          .onConflictDoNothing()
          .run();
        return selected.map((row) =>
          toKnowledgeItem({ ...row, status: 'active', updatedAt: batch.event.occurredAt }),
        );
      });
    },
    async pause(input) {
      return db.transaction((tx) => {
        if (input.itemIds.length === 0) return [];
        const rows = tx
          .select()
          .from(t.knowledgeItems)
          .where(
            and(
              eq(t.knowledgeItems.learnerId, input.learnerId),
              eq(t.knowledgeItems.status, 'active'),
              inArray(t.knowledgeItems.id, input.itemIds),
            ),
          )
          .all();
        const selectedIds = new Set(rows.map((row) => row.id));
        for (const row of rows) {
          tx.update(t.knowledgeItems)
            .set({ status: 'new', updatedAt: input.nowIso })
            .where(eq(t.knowledgeItems.id, row.id))
            .run();
        }
        if (selectedIds.size > 0) {
          tx.update(t.learnerStates)
            .set({ nextReviewAt: null, updatedAt: input.nowIso })
            .where(
              and(
                eq(t.learnerStates.learnerId, input.learnerId),
                eq(t.learnerStates.subjectType, 'knowledge_item'),
                inArray(t.learnerStates.subjectId, [...selectedIds]),
              ),
            )
            .run();
          const logs = input.logs.filter(
            (entry) => entry.knowledgeItemId !== null && selectedIds.has(entry.knowledgeItemId),
          );
          if (logs.length > 0) tx.insert(t.knowledgeOperationLog).values(logs).run();
        }
        return rows.map((row) =>
          toKnowledgeItem({ ...row, status: 'new', updatedAt: input.nowIso }),
        );
      });
    },
  };
}

export function createFileImportRepository(db: Db): FileImportRepository {
  return {
    async commit(batch) {
      const fileHash = batch.history.fileHash;
      if (!fileHash) throw new Error('File import requires a hash');
      return db.transaction((tx) => {
        const duplicateRows = tx
          .select()
          .from(t.importExportHistory)
          .where(
            and(
              eq(t.importExportHistory.learnerId, batch.history.learnerId),
              eq(t.importExportHistory.fileHash, fileHash),
              eq(t.importExportHistory.type, 'import'),
            ),
          )
          .limit(1)
          .all();
        if (duplicateRows[0]) {
          const original = toImportExportHistory(duplicateRows[0]);
          const duplicateAttempt = {
            ...batch.history,
            fileHash: null,
            addedCount: 0,
            duplicateCount: batch.history.totalCount - batch.history.failedCount,
            status: 'success' as const,
            errors: [{ row: 0, reason: `重复文件，原导入记录 ${original.id}` }],
            wordlistId: original.wordlistId,
            goalId: original.goalId,
          };
          tx.insert(t.importExportHistory).values(duplicateAttempt).run();
          return {
            duplicateFile: true,
            history: duplicateAttempt,
            wordlist: null,
            insertedItems: [],
            completedCount: 0,
          };
        }

        const existingRows = tx
          .select({ normalizedText: t.knowledgeItems.normalizedText })
          .from(t.knowledgeItems)
          .where(
            and(
              eq(t.knowledgeItems.learnerId, batch.wordlist.learnerId),
              eq(t.knowledgeItems.languageCode, batch.wordlist.languageCode),
            ),
          )
          .all();
        const seen = new Set(existingRows.map((row) => row.normalizedText));
        const insertedItems = batch.items.filter((item) => {
          if (seen.has(item.normalizedText)) return false;
          seen.add(item.normalizedText);
          return true;
        });
        const insertedIds = new Set(insertedItems.map((item) => item.id));
        const duplicateCount = batch.history.duplicateCount + batch.items.length - insertedItems.length;
        const status =
          batch.history.failedCount > 0
            ? insertedItems.length > 0
              ? ('partial' as const)
              : ('failed' as const)
            : ('success' as const);
        const history = {
          ...batch.history,
          addedCount: insertedItems.length,
          duplicateCount,
          status,
        };
        const wordlist = { ...batch.wordlist, itemCount: insertedItems.length };

        tx.insert(t.wordlists).values(wordlist).run();
        for (let offset = 0; offset < insertedItems.length; offset += 200) {
          tx.insert(t.knowledgeItems)
            .values(insertedItems.slice(offset, offset + 200))
            .run();
        }
        const states = batch.states.filter((state) => insertedIds.has(state.subjectId));
        for (let offset = 0; offset < states.length; offset += 200) {
          tx.insert(t.learnerStates)
            .values(states.slice(offset, offset + 200))
            .onConflictDoNothing()
            .run();
        }
        const logs = batch.logs.filter(
          (entry) => entry.knowledgeItemId !== null && insertedIds.has(entry.knowledgeItemId),
        );
        for (let offset = 0; offset < logs.length; offset += 200) {
          tx.insert(t.knowledgeOperationLog)
            .values(logs.slice(offset, offset + 200))
            .run();
        }

        // Fill-only completion (v0.3 §P5): never overwrite an existing value.
        for (const completion of batch.completions) {
          tx.update(t.knowledgeItems)
            .set(completion)
            .where(eq(t.knowledgeItems.id, completion.id))
            .run();
        }
        for (let offset = 0; offset < batch.completionLogs.length; offset += 200) {
          tx.insert(t.knowledgeOperationLog)
            .values(batch.completionLogs.slice(offset, offset + 200))
            .run();
        }
        tx.insert(t.importExportHistory).values(history).run();

        return {
          duplicateFile: false,
          history,
          wordlist,
          insertedItems,
          completedCount: batch.completions.length,
        };
      });
    },
  };
}

export function createWordlistRepository(db: Db): WordlistRepository {
  return {
    async create(wordlist) {
      await db.insert(t.wordlists).values(wordlist);
      return wordlist;
    },
    async update(wordlist) {
      await db.update(t.wordlists).set(wordlist).where(eq(t.wordlists.id, wordlist.id));
      return wordlist;
    },
    async findById(id) {
      const rows = await db.select().from(t.wordlists).where(eq(t.wordlists.id, id)).limit(1);
      return rows.length > 0 ? toWordlist(rows[0]!) : null;
    },
    async listByLearner(learnerId) {
      const rows = await db
        .select()
        .from(t.wordlists)
        .where(eq(t.wordlists.learnerId, learnerId))
        .orderBy(desc(t.wordlists.createdAt));
      return rows.map(toWordlist);
    },
    async delete(id) {
      await db.delete(t.wordlists).where(eq(t.wordlists.id, id));
    },
  };
}

export function createImportExportHistoryRepository(
  db: Db,
): ImportExportHistoryRepository {
  return {
    async create(record) {
      await db.insert(t.importExportHistory).values(record);
      return record;
    },
    async update(record) {
      await db
        .update(t.importExportHistory)
        .set(record)
        .where(eq(t.importExportHistory.id, record.id));
      return record;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(t.importExportHistory)
        .where(eq(t.importExportHistory.id, id))
        .limit(1);
      return rows.length > 0 ? toImportExportHistory(rows[0]!) : null;
    },
    async findByFileHash(learnerId, fileHash) {
      if (!fileHash) return null;
      const rows = await db
        .select()
        .from(t.importExportHistory)
        .where(
          and(
            eq(t.importExportHistory.learnerId, learnerId),
            eq(t.importExportHistory.fileHash, fileHash),
            eq(t.importExportHistory.type, 'import'),
          ),
        )
        .orderBy(desc(t.importExportHistory.createdAt))
        .limit(1);
      return rows.length > 0 ? toImportExportHistory(rows[0]!) : null;
    },
    async listByLearner(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.importExportHistory)
        .where(eq(t.importExportHistory.learnerId, learnerId))
        .orderBy(desc(t.importExportHistory.createdAt))
        .limit(limit);
      return rows.map(toImportExportHistory);
    },
  };
}

export function createKnowledgeOperationLogRepository(
  db: Db,
): KnowledgeOperationLogRepository {
  return {
    async append(entry) {
      await db.insert(t.knowledgeOperationLog).values(entry);
      return entry;
    },
    async listByLearner(learnerId, limit, offset = 0, operations) {
      const where =
        operations && operations.length > 0
          ? and(
              eq(t.knowledgeOperationLog.learnerId, learnerId),
              inArray(t.knowledgeOperationLog.operation, operations),
            )
          : eq(t.knowledgeOperationLog.learnerId, learnerId);
      const rows = await db
        .select()
        .from(t.knowledgeOperationLog)
        .where(where)
        .orderBy(desc(t.knowledgeOperationLog.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toKnowledgeOperationLog);
    },
    async listByItem(learnerId, knowledgeItemId, limit) {
      const rows = await db
        .select()
        .from(t.knowledgeOperationLog)
        .where(
          and(
            eq(t.knowledgeOperationLog.learnerId, learnerId),
            eq(t.knowledgeOperationLog.knowledgeItemId, knowledgeItemId),
          ),
        )
        .orderBy(desc(t.knowledgeOperationLog.createdAt))
        .limit(limit);
      return rows.map(toKnowledgeOperationLog);
    },
    async countByLearner(learnerId) {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(t.knowledgeOperationLog)
        .where(eq(t.knowledgeOperationLog.learnerId, learnerId));
      return rows[0]?.value ?? 0;
    },
  };
}

export function createScenarioRepository(db: Db): ScenarioRepository {
  return {
    async create(scenario) {
      await db.insert(t.scenarios).values(scenario);
      return scenario;
    },
    async update(scenario) {
      await db.update(t.scenarios).set(scenario).where(eq(t.scenarios.id, scenario.id));
      return scenario;
    },
    async findById(id) {
      const rows = await db.select().from(t.scenarios).where(eq(t.scenarios.id, id)).limit(1);
      return rows.length > 0 ? toScenario(rows[0]!) : null;
    },
    async listByLearner(learnerId, statuses) {
      const where =
        statuses && statuses.length > 0
          ? and(eq(t.scenarios.learnerId, learnerId), inArray(t.scenarios.status, statuses))
          : eq(t.scenarios.learnerId, learnerId);
      const rows = await db
        .select()
        .from(t.scenarios)
        .where(where)
        .orderBy(desc(t.scenarios.createdAt));
      return rows.map(toScenario);
    },
    async listByGoal(goalId) {
      const rows = await db
        .select()
        .from(t.scenarios)
        .where(eq(t.scenarios.goalId, goalId))
        .orderBy(desc(t.scenarios.createdAt));
      return rows.map(toScenario);
    },
    async archiveExpired(learnerId, nowIso) {
      const activeRows = await db
        .select()
        .from(t.scenarios)
        .where(
          and(eq(t.scenarios.learnerId, learnerId), eq(t.scenarios.status, 'active')),
        );
      let count = 0;
      for (const row of activeRows) {
        const tc = row.timeContext as { resolvedDueAt?: string | null } | null;
        if (tc?.resolvedDueAt && tc.resolvedDueAt <= nowIso) {
          await db
            .update(t.scenarios)
            .set({ status: 'done', updatedAt: nowIso })
            .where(eq(t.scenarios.id, row.id));
          count++;
        }
      }
      return count;
    },
    async delete(id) {
      await db.delete(t.scenarios).where(eq(t.scenarios.id, id));
    },
  };
}

// ── v0.4 repository factories ────────────────────────────────────────────────

export function createPlacementRepository(db: Db): PlacementRepository {
  return {
    async create(placement: Placement) {
      await db.insert(t.placements).values(placement);
      return placement;
    },
    async listByLearner(learnerId, limit) {
      const rows = await db
        .select()
        .from(t.placements)
        .where(eq(t.placements.learnerId, learnerId))
        .orderBy(desc(t.placements.createdAt))
        .limit(limit);
      return rows.map(toPlacement);
    },
    async findLatest(learnerId) {
      const rows = await db
        .select()
        .from(t.placements)
        .where(eq(t.placements.learnerId, learnerId))
        .orderBy(desc(t.placements.createdAt))
        .limit(1);
      return rows.length > 0 ? toPlacement(rows[0]!) : null;
    },
  };
}

export function createGoalPhaseRepository(db: Db): GoalPhaseRepository {
  return {
    async createMany(phases: GoalPhase[]) {
      if (phases.length === 0) return [];
      await db.insert(t.goalPhases).values(phases);
      return phases;
    },
    async update(phase: GoalPhase) {
      await db.update(t.goalPhases).set(phase).where(eq(t.goalPhases.id, phase.id));
      return phase;
    },
    async listByGoal(goalId) {
      const rows = await db
        .select()
        .from(t.goalPhases)
        .where(eq(t.goalPhases.goalId, goalId))
        .orderBy(asc(t.goalPhases.seq));
      return rows.map(toGoalPhase);
    },
    async findById(id) {
      const rows = await db.select().from(t.goalPhases).where(eq(t.goalPhases.id, id)).limit(1);
      return rows.length > 0 ? toGoalPhase(rows[0]!) : null;
    },
    async findActiveByGoal(goalId) {
      const rows = await db
        .select()
        .from(t.goalPhases)
        .where(and(eq(t.goalPhases.goalId, goalId), eq(t.goalPhases.status, 'active')))
        .limit(1);
      return rows.length > 0 ? toGoalPhase(rows[0]!) : null;
    },
  };
}

export function createWordRelationRepository(db: Db): WordRelationRepository {
  return {
    async upsert(relation: WordRelation) {
      await db
        .insert(t.wordRelations)
        .values(relation)
        .onConflictDoNothing({ target: t.wordRelations.id });
      return relation;
    },
    async upsertMany(relations: WordRelation[]) {
      if (relations.length === 0) return [];
      // Idempotent on the primary key: callers supply a deterministic id
      // (hash of the relation tuple) so re-running never duplicates.
      for (let offset = 0; offset < relations.length; offset += 500) {
        await db
          .insert(t.wordRelations)
          .values(relations.slice(offset, offset + 500))
          .onConflictDoNothing({ target: t.wordRelations.id });
      }
      return relations;
    },
    async listByLemma(wordLemma) {
      const rows = await db
        .select()
        .from(t.wordRelations)
        .where(eq(t.wordRelations.wordLemma, wordLemma));
      return rows.map(toWordRelation);
    },
    async listByLemmas(wordLemmas) {
      const unique = [...new Set(wordLemmas)];
      if (unique.length === 0) return [];
      const rows = await db
        .select()
        .from(t.wordRelations)
        .where(inArray(t.wordRelations.wordLemma, unique));
      return rows.map(toWordRelation);
    },
    async listByTopic(topic) {
      const rows = await db
        .select()
        .from(t.wordRelations)
        .where(
          and(
            eq(t.wordRelations.relationType, 'topic'),
            eq(t.wordRelations.topic, topic),
          ),
        );
      return rows.map(toWordRelation);
    },
    async count() {
      const rows = await db.select({ value: sql<number>`count(*)` }).from(t.wordRelations);
      return rows[0]?.value ?? 0;
    },
  };
}
