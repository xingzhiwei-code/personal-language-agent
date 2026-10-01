import type { KnowledgeItem, LearnerState } from '@/domain/entities';
import type { FeedbackKind, SubjectType } from '@/domain/enums';
import { applyNotRelevant, applyUserDeclaredMastery } from '@/learner/state';
import { appendEvent } from './events';
import { loadOrCreateState, saveState } from './learner-state';
import { saveMemory, setPreference } from './memory';
import type { AppContext } from './types';

export interface RecordFeedbackInput {
  learnerId: string;
  kind: FeedbackKind;
  subjectType?: SubjectType | null;
  subjectId?: string | null;
  sessionId?: string | null;
  note?: string | null;
}

export interface RecordFeedbackResult {
  state: LearnerState | null;
  item: KnowledgeItem | null;
  /** Short, non-judgemental confirmation for the UI. */
  message: string;
}

/**
 * User feedback always wins. We record it, change real state, and never argue
 * with the learner (PRD §5.1 / §13).
 */
export async function recordFeedback(
  ctx: AppContext,
  input: RecordFeedbackInput,
): Promise<RecordFeedbackResult> {
  const now = ctx.clock.nowIso();
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'user_feedback',
    source: 'user',
    sessionId: input.sessionId ?? null,
    idempotencyKey: `feedback:${input.kind}:${input.subjectId ?? 'none'}:${now}`,
    payload: {
      kind: input.kind,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      note: input.note ?? null,
    },
  });

  let state: LearnerState | null = null;
  let item: KnowledgeItem | null = null;
  let message = '已记录你的反馈';

  const subjectType = input.subjectType ?? 'knowledge_item';

  switch (input.kind) {
    case 'already_known': {
      if (input.subjectId) {
        const current = await loadOrCreateState(
          ctx,
          input.learnerId,
          subjectType,
          input.subjectId,
        );
        state = await saveState(ctx, applyUserDeclaredMastery(current, now));
        if (subjectType === 'knowledge_item') {
          item = await ctx.repos.knowledge.findById(input.subjectId);
          if (item) {
            item = { ...item, status: 'user_mastered', updatedAt: now };
            await ctx.repos.knowledge.update(item);
          }
        }
      }
      message = '好的，这条先不再频繁出现了';
      break;
    }
    case 'not_relevant': {
      if (input.subjectId) {
        const current = await loadOrCreateState(
          ctx,
          input.learnerId,
          subjectType,
          input.subjectId,
        );
        state = await saveState(ctx, applyNotRelevant(current, now));
        if (subjectType === 'knowledge_item') {
          item = await ctx.repos.knowledge.findById(input.subjectId);
          if (item) {
            item = { ...item, status: 'irrelevant', updatedAt: now };
            await ctx.repos.knowledge.update(item);
          }
        }
      }
      message = '已标记为不相关，不会再安排它';
      break;
    }
    case 'too_easy':
    case 'too_hard': {
      // A single signal is an observation, not a permanent preference.
      await saveMemory(ctx, {
        learnerId: input.learnerId,
        key: `difficulty_signal:${input.kind}`,
        kind: 'preference',
        content: input.kind === 'too_easy' ? '觉得练习偏简单' : '觉得练习偏难',
        source: 'observed',
      });
      message = input.kind === 'too_easy' ? '知道了，会安排更有挑战的' : '知道了，会安排更简单的起点';
      break;
    }
    case 'chat_only': {
      await saveMemory(ctx, {
        learnerId: input.learnerId,
        key: 'prefers_chat_sometimes',
        kind: 'preference',
        content: '有时只想聊天，不想做练习',
        source: 'observed',
      });
      message = '好的，直接聊天';
      break;
    }
    case 'correction_disabled':
    case 'correction_enabled': {
      message = input.kind === 'correction_disabled' ? '这次不纠正语法' : '会帮你纠正语法';
      break;
    }
    case 'recommendation_rejected': {
      message = '换一个吧，不需要解释';
      break;
    }
    case 'assessment_corrected': {
      message = '已按你的判断更新';
      break;
    }
  }

  if (input.note && input.note.trim().length > 0) {
    await setPreference(ctx, {
      learnerId: input.learnerId,
      key: `note:${input.kind}`,
      value: input.note.trim().slice(0, 200),
      source: 'user_explicit',
    });
  }

  return { state, item, message };
}
