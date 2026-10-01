import { validationFailed } from '@/domain/errors';
import { appendEvent } from './events';
import type { AppContext } from './types';

export const DELETE_CONFIRMATION_PHRASE = '删除我的数据';

export interface LearnerDataExport {
  formatVersion: 1;
  exportedAt: string;
  learnerId: string;
  /** Plain-language note about what this file contains. */
  notice: string;
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
}

/**
 * Full, human-readable JSON export of everything we store about the learner
 * (PRD §F-10). No secrets or provider keys are included.
 */
export async function exportLearnerData(
  ctx: AppContext,
  learnerId: string,
): Promise<LearnerDataExport> {
  const sessions = await ctx.repos.sessions.listByLearner(learnerId, 1000);
  const activities: unknown[] = [];
  const chat: unknown[] = [];
  for (const session of sessions) {
    activities.push(...(await ctx.repos.activities.listBySession(session.id)));
    chat.push(...(await ctx.repos.chat.listBySession(session.id)));
  }

  return {
    formatVersion: 1,
    exportedAt: ctx.clock.nowIso(),
    learnerId,
    notice:
      '这份文件包含你在本地保存的全部学习数据。数据库存储在本机；只有在你使用 AI 对话/解释功能时，相关的少量上下文才会发送给你配置的 AI 服务商。',
    user: await ctx.repos.users.findById(learnerId),
    goals: await ctx.repos.goals.listByLearner(learnerId),
    learningTargets: await ctx.repos.targets.listByLearner(learnerId),
    knowledgeItems: await ctx.repos.knowledge.search({ learnerId, limit: 10_000 }),
    knowledgeRelations: await ctx.repos.relations.listByLearner(learnerId),
    learnerStates: await ctx.repos.states.listByLearner(learnerId),
    learningSessions: sessions,
    learningActivities: activities,
    assessments: await ctx.repos.assessments.listByLearner(learnerId, 10_000),
    learningEvents: await ctx.repos.events.listByLearner(learnerId, 10_000),
    chatMessages: chat,
    memories: await ctx.repos.memories.listByLearner(learnerId),
    preferences: await ctx.repos.preferences.listByLearner(learnerId),
    userContexts: await ctx.repos.contexts.listByLearner(learnerId, 1000),
    recommendations: await ctx.repos.recommendations.listRecent(learnerId, 1000),
    transferEvidence: await ctx.repos.transfer.listByLearner(learnerId, 1000),
    contentSources: await ctx.repos.content.listSourcesByLearner(learnerId, 1000),
  };
}

/**
 * Writes a copy of the export through the ObjectStorage port and returns the
 * key. V0.1 stores it on local disk; a cloud implementation can be swapped in
 * later without touching this code.
 */
export async function saveExportToStorage(
  ctx: AppContext,
  learnerId: string,
): Promise<{ key: string; bytes: number }> {
  const data = await exportLearnerData(ctx, learnerId);
  const json = JSON.stringify(data, null, 2);
  const key = `exports/${learnerId}/${data.exportedAt.replace(/[:.]/g, '-')}.json`;
  await ctx.storage.put(key, json, 'application/json');
  return { key, bytes: Buffer.byteLength(json, 'utf8') };
}

/** Irreversible local deletion, gated by an explicit confirmation phrase. */
export async function deleteLearnerData(
  ctx: AppContext,
  learnerId: string,
  confirmation: string,
): Promise<{ deleted: true }> {
  if (confirmation.trim() !== DELETE_CONFIRMATION_PHRASE) {
    throw validationFailed(`请输入「${DELETE_CONFIRMATION_PHRASE}」以确认删除`);
  }

  await ctx.repos.deleteAllForLearner(learnerId);

  const keys = await ctx.storage.list(`exports/${learnerId}`);
  for (const key of keys) {
    await ctx.storage.delete(key);
  }

  // Recreate the learner row so the app stays usable after deletion.
  const now = ctx.clock.nowIso();
  await ctx.repos.users.upsert({
    id: learnerId,
    displayName: '我',
    nativeLanguage: 'zh',
    createdAt: now,
    updatedAt: now,
  });
  await appendEvent(ctx, {
    learnerId,
    type: 'user_feedback',
    source: 'user',
    idempotencyKey: `data-deleted:${now}`,
    payload: { kind: 'data_deleted' },
  });

  return { deleted: true };
}
