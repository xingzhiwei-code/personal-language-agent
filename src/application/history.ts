import type {
  Assessment,
  ChatMessage,
  KnowledgeItem,
  LearningActivity,
  LearningEvent,
  LearningSession,
} from '@/domain/entities';
import { notFound } from '@/domain/errors';
import type { AppContext } from './types';

export interface HistoryEntry {
  session: LearningSession;
  assessmentCount: number;
  correctCount: number;
  /** Minutes actually spent, when we can measure it (start -> end). */
  durationMinutes: number | null;
}

export async function getLearningHistory(
  ctx: AppContext,
  learnerId: string,
  limit = 30,
): Promise<HistoryEntry[]> {
  const sessions = await ctx.repos.sessions.listByLearner(learnerId, limit);
  const entries: HistoryEntry[] = [];
  for (const session of sessions) {
    const assessments = await ctx.repos.assessments.listBySession(session.id);
    entries.push({
      session,
      assessmentCount: assessments.length,
      correctCount: assessments.filter((assessment) => assessment.correct).length,
      durationMinutes:
        session.startedAt && session.endedAt
          ? Math.max(
              0,
              Math.round(
                ((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000) * 10,
              ) / 10,
            )
          : null,
    });
  }
  return entries;
}

export interface SessionDetail {
  session: LearningSession;
  activities: LearningActivity[];
  assessments: Assessment[];
  events: LearningEvent[];
  chat: ChatMessage[];
  knowledge: KnowledgeItem[];
}

export async function getSessionDetail(
  ctx: AppContext,
  learnerId: string,
  sessionId: string,
): Promise<SessionDetail> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session || session.learnerId !== learnerId) throw notFound('LearningSession', sessionId);

  const [activities, assessments, events, chat] = await Promise.all([
    ctx.repos.activities.listBySession(sessionId),
    ctx.repos.assessments.listBySession(sessionId),
    ctx.repos.events.listBySession(sessionId),
    ctx.repos.chat.listBySession(sessionId),
  ]);

  const ids = [
    ...new Set([
      ...activities.map((activity) => activity.subjectId),
      ...assessments.map((assessment) => assessment.subjectId),
    ]),
  ];

  return {
    session,
    activities,
    assessments,
    events,
    chat,
    knowledge: await ctx.repos.knowledge.listByIds(ids),
  };
}
