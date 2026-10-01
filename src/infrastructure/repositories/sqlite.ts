import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lte, or, sql } from 'drizzle-orm';
import type {
  Assessment,
  ChatMessage,
  Content,
  ContentSource,
  Goal,
  KnowledgeItem,
  KnowledgeRelation,
  LearnerState,
  LearningActivity,
  LearningEvent,
  LearningPreference,
  LearningSession,
  LearningTarget,
  Memory,
  Recommendation,
  TransferEvidence,
  User,
  UserContext,
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
  GoalRepository,
  KnowledgeRelationRepository,
  KnowledgeRepository,
  KnowledgeSearchQuery,
  LearnerStateRepository,
  LearningTargetRepository,
  MemoryRepository,
  PreferenceRepository,
  RecommendationRepository,
  Repositories,
  SessionRepository,
  TransferEvidenceRepository,
  UserContextRepository,
  UserRepository,
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
  toKnowledgeItem,
  toLearnerState,
  toMemory,
  toPreference,
  toRecommendation,
  toRelation,
  toSession,
  toTarget,
  toTransferEvidence,
  toUser,
  toUserContext,
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
    async update(goal: Goal) {
      await db.update(t.goals).set(goal).where(eq(t.goals.id, goal.id));
      return goal;
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
        .set({ isPrimary: false })
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
    async search(query) {
      const rows = await db
        .select()
        .from(t.knowledgeItems)
        .where(knowledgeWhere(query))
        .orderBy(desc(t.knowledgeItems.updatedAt))
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
    activities,
    chat,
    memories: memoriesRepo,
    preferences,
    contexts,
    recommendations: recommendationsRepo,
    transfer,
    content,
    async deleteAllForLearner(learnerId: string) {
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
      });
    },
  };
}
