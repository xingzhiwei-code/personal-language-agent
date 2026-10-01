import { z } from 'zod';
import type {
  Goal,
  KnowledgeItem,
  LearnerState,
  LearningEvent,
  LearningSession,
  Memory,
  TransferEvidence,
  UserContext,
} from '@/domain/entities';
import {
  activityTypeSchema,
  knowledgeRelationTypeSchema,
  modalitySchema,
  subjectTypeSchema,
} from '@/domain/enums';
import { submitAssessment } from './assessment';
import { getCurrentContext } from './context';
import { appendEvent } from './events';
import { recordFeedback } from './feedback';
import { getLearningHistory, type HistoryEntry } from './history';
import { createKnowledgeItem, getKnowledgeDetail } from './knowledge';
import { saveMemory } from './memory';
import { buildSchedulerSnapshot } from './recommendations';
import { startSession } from './sessions';
import { getTransferEvidence } from './transfer';
import type { AppContext } from './types';

/**
 * The Agent tool surface.
 *
 * The agent NEVER touches the database, the ORM or the domain internals: every
 * read and write goes through these validated application services
 * (PRD §10.3). That keeps domain rules, idempotency and the learner model
 * authoritative regardless of what the model outputs.
 */
export interface AgentTools {
  getLearnerState(input: { subjectType: string; subjectId: string }): Promise<LearnerState | null>;
  getGoals(): Promise<Goal[]>;
  getWeakSkills(input?: { limit?: number }): Promise<
    { skill: string; mastery: number; confidence: number; importance: number }[]
  >;
  getDueReviews(input?: { limit?: number }): Promise<
    { knowledgeItemId: string; text: string; meaning: string | null; overdueDays: number }[]
  >;
  searchKnowledge(input: { text?: string; limit?: number }): Promise<KnowledgeItem[]>;
  searchKnowledgeGraph(input: { knowledgeItemId: string }): Promise<
    { relation: string; direction: 'in' | 'out'; item: KnowledgeItem }[]
  >;
  getUserContext(): Promise<UserContext | null>;
  createSession(input: {
    activityType: string;
    plannedDurationMinutes?: number;
    clientToken: string;
  }): Promise<LearningSession>;
  recordLearningEvent(input: {
    type: 'chat_message' | 'user_feedback' | 'knowledge_added';
    payload: Record<string, unknown>;
    sessionId?: string | null;
  }): Promise<LearningEvent>;
  submitAssessment(input: {
    subjectId: string;
    modality: string;
    score: number;
    sessionId?: string | null;
    userAnswer?: string | null;
    idempotencyKey: string;
  }): Promise<{ mastery: number; confidence: number }>;
  saveMemory(input: { key: string; content: string; kind?: string }): Promise<Memory>;
  saveKnowledge(input: {
    text: string;
    meaning?: string | null;
    example?: string | null;
    languageCode?: string;
    aiGenerated?: boolean;
  }): Promise<KnowledgeItem>;
  getLearningHistory(input?: { limit?: number }): Promise<HistoryEntry[]>;
  getTransferEvidence(): Promise<TransferEvidence[]>;
  recordFeedback(input: {
    kind: 'already_known' | 'not_relevant' | 'too_easy' | 'too_hard' | 'chat_only';
    subjectId?: string | null;
    sessionId?: string | null;
  }): Promise<{ message: string }>;
}

const limitSchema = z.number().int().min(1).max(50).optional();

export function createAgentTools(ctx: AppContext, learnerId: string): AgentTools {
  return {
    async getLearnerState(input) {
      const subjectType = subjectTypeSchema.parse(input.subjectType);
      const subjectId = z.string().min(1).max(120).parse(input.subjectId);
      return ctx.repos.states.find(learnerId, subjectType, subjectId);
    },

    async getGoals() {
      return ctx.repos.goals.listByLearner(learnerId, ['active', 'paused']);
    },

    async getWeakSkills(input) {
      const limit = limitSchema.parse(input?.limit) ?? 5;
      const { snapshot } = await buildSchedulerSnapshot(ctx, learnerId);
      return snapshot.targets
        .map((target) => {
          const state = snapshot.skillStates.find(
            (entry) => entry.subjectId === target.skill,
          );
          return {
            skill: target.skill,
            mastery: state?.mastery ?? 0,
            confidence: state?.confidence ?? 0,
            importance: target.importance,
          };
        })
        .sort((a, b) => a.mastery - b.mastery)
        .slice(0, limit);
    },

    async getDueReviews(input) {
      const limit = limitSchema.parse(input?.limit) ?? 10;
      const { dueCandidates } = await buildSchedulerSnapshot(ctx, learnerId);
      return dueCandidates.slice(0, limit).map((candidate) => ({
        knowledgeItemId: candidate.item.id,
        text: candidate.item.text,
        meaning: candidate.item.meaning,
        overdueDays: candidate.overdueDays,
      }));
    },

    async searchKnowledge(input) {
      const text = z.string().max(200).optional().parse(input.text);
      const limit = limitSchema.parse(input.limit) ?? 10;
      return ctx.repos.knowledge.search({
        learnerId,
        text,
        statuses: ['active'],
        limit,
      });
    },

    async searchKnowledgeGraph(input) {
      const id = z.string().min(1).max(64).parse(input.knowledgeItemId);
      const detail = await getKnowledgeDetail(ctx, learnerId, id);
      return detail.relations.map((entry) => ({
        relation: knowledgeRelationTypeSchema.parse(entry.relation.type),
        direction: entry.direction === 'out' ? ('out' as const) : ('in' as const),
        item: entry.other,
      }));
    },

    async getUserContext() {
      return getCurrentContext(ctx, learnerId);
    },

    async createSession(input) {
      const activityType = activityTypeSchema.parse(input.activityType);
      const minutes = z.number().int().min(1).max(60).optional().parse(
        input.plannedDurationMinutes,
      );
      const clientToken = z.string().min(1).max(120).parse(input.clientToken);
      const { session } = await startSession(ctx, {
        learnerId,
        activityType,
        plannedDurationMinutes: minutes ?? null,
        clientToken,
      });
      return session;
    },

    async recordLearningEvent(input) {
      const type = z
        .enum(['chat_message', 'user_feedback', 'knowledge_added'])
        .parse(input.type);
      const { event } = await appendEvent(ctx, {
        learnerId,
        type,
        source: 'agent',
        sessionId: input.sessionId ?? null,
        payload: input.payload,
        idempotencyKey: `agent-event:${type}:${ctx.ids.next()}`,
      });
      return event;
    },

    async submitAssessment(input) {
      const modality = modalitySchema.parse(input.modality);
      const score = z.number().min(0).max(1).parse(input.score);
      const result = await submitAssessment(ctx, {
        learnerId,
        subjectType: 'knowledge_item',
        subjectId: z.string().min(1).max(120).parse(input.subjectId),
        modality,
        score,
        sessionId: input.sessionId ?? null,
        userAnswer: input.userAnswer ?? null,
        source: 'agent',
        idempotencyKey: z.string().min(1).max(200).parse(input.idempotencyKey),
      });
      return { mastery: result.state.mastery, confidence: result.state.confidence };
    },

    async saveMemory(input) {
      return saveMemory(ctx, {
        learnerId,
        key: z.string().min(1).max(120).parse(input.key),
        kind: z
          .enum(['preference', 'fact', 'goal_note', 'correction', 'interest'])
          .catch('fact')
          .parse(input.kind ?? 'fact'),
        content: z.string().min(1).max(2000).parse(input.content),
        source: 'observed',
      });
    },

    async saveKnowledge(input) {
      const { item } = await createKnowledgeItem(ctx, {
        learnerId,
        text: z.string().min(1).max(400).parse(input.text),
        meaning: input.meaning ?? null,
        languageCode: input.languageCode ?? 'en',
        examples: input.example
          ? [{ text: input.example, origin: input.aiGenerated ? 'ai_generated' : 'user' }]
          : [],
        // Anything the agent produces is flagged as AI-generated provenance.
        aiGenerated: input.aiGenerated ?? true,
        origin: input.aiGenerated === false ? 'user' : 'ai_generated',
        sourceType: input.aiGenerated === false ? 'user_manual' : 'ai_generated',
      });
      return item;
    },

    async getLearningHistory(input) {
      return getLearningHistory(ctx, learnerId, limitSchema.parse(input?.limit) ?? 10);
    },

    async getTransferEvidence() {
      return getTransferEvidence(ctx, learnerId, 20);
    },

    async recordFeedback(input) {
      const result = await recordFeedback(ctx, {
        learnerId,
        kind: input.kind,
        subjectType: input.subjectId ? 'knowledge_item' : null,
        subjectId: input.subjectId ?? null,
        sessionId: input.sessionId ?? null,
      });
      return { message: result.message };
    },
  };
}
