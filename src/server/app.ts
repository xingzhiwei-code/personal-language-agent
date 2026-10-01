import { LOCAL_LEARNER_ID, type AppContext } from '@/application/types';
import { DomainError } from '@/domain/errors';
import { getAppContext } from '@/infrastructure/container';

/**
 * Server-side glue used by pages and server actions.
 * V0.1 is single-user: the learner id is fixed and no auth is required, but all
 * services still take an explicit learnerId so multi-user can be added later
 * without changing the domain.
 */
export function app(): { ctx: AppContext; learnerId: string } {
  return { ctx: getAppContext(), learnerId: LOCAL_LEARNER_ID };
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; message: string };

/** Payload returned to the UI after grading one activity answer. */
export interface AnswerFeedbackData {
  verdict: string;
  score: number;
  expected: string | null;
  assessmentId: string | null;
  finished: boolean;
}

const FRIENDLY: Record<string, string> = {
  ai_unavailable: 'AI 服务暂时不可用，其他功能仍然可以使用。',
  ai_timeout: 'AI 响应超时了，可以再试一次，或者先做本地复习。',
  not_found: '找不到这个内容，可能已经被删除了。',
  conflict: '这条内容已经存在了。',
  invalid_state_transition: '当前状态下不能执行这个操作。',
  unsupported_language: '暂时还不支持这个语言。',
};

/**
 * Converts any thrown error into a safe, human message.
 * Never exposes stack traces, SQL or provider payloads to the user.
 */
export function toActionError(error: unknown): string {
  if (error instanceof DomainError) {
    if (error.code === 'validation_failed') return error.message;
    return FRIENDLY[error.code] ?? error.message;
  }
  if (error instanceof Error) {
    console.error('[action]', error.message);
  } else {
    console.error('[action] unknown error');
  }
  return '操作没有完成，请稍后再试。';
}
