import type { ChatMessage } from '@/domain/entities';
import { DomainError } from '@/domain/errors';
import { captureContext } from '@/application/context';
import { appendEvent } from '@/application/events';
import { recordFeedback } from '@/application/feedback';
import { createKnowledgeItem } from '@/application/knowledge';
import { setSessionCorrection } from '@/application/sessions';
import type { AppContext } from '@/application/types';
import { normalizeKnowledgeText } from '@/language/registry';
import {
  buildAgentContext,
  renderSystemPrompt,
  toLlmHistory,
} from './context-builder';
import { routeMessage, type AgentRoute } from './router';

export interface AgentTurnInput {
  learnerId: string;
  sessionId: string;
  text: string;
  /** Term the UI was last showing, so "保存这个" works without re-typing. */
  lastTerm?: string | null;
}

export interface AgentSuggestion {
  kind: 'save_knowledge' | 'micro_practice' | 'start_review' | 'navigate';
  label: string;
  term?: string | null;
  target?: string | null;
}

export interface AgentTurnResult {
  reply: string;
  route: AgentRoute['kind'];
  action: string | null;
  usedLlm: boolean;
  degraded: boolean;
  term: string | null;
  suggestions: AgentSuggestion[];
  messages: ChatMessage[];
}

const DEGRADED_REPLY =
  'AI 对话现在连不上（没有配置或服务异常）。不过你的历史记录、知识库和复习都还能正常用——要不要先做一次复习？';

/**
 * One agent turn. Deterministic commands are executed locally and instantly;
 * only real language understanding/generation reaches the LLM.
 */
export async function runAgentTurn(
  ctx: AppContext,
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new DomainError('validation_failed', '请输入内容');
  }

  const session = await ctx.repos.sessions.findById(input.sessionId);
  if (!session || session.learnerId !== input.learnerId) {
    throw new DomainError('not_found', '找不到这个会话');
  }

  const now = ctx.clock.nowIso();
  const userMessage: ChatMessage = {
    id: ctx.ids.next(),
    sessionId: session.id,
    learnerId: input.learnerId,
    role: 'user',
    text,
    aiGenerated: false,
    meta: null,
    createdAt: now,
  };
  await ctx.repos.chat.create(userMessage);
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'chat_message',
    source: 'user',
    sessionId: session.id,
    idempotencyKey: `chat:${userMessage.id}`,
    payload: { role: 'user', length: text.length },
  });

  const route = routeMessage({ text, aiAvailable: ctx.llm.isConfigured() });
  const term = route.term ?? input.lastTerm ?? null;

  let reply: string;
  let usedLlm = false;
  let degraded = false;
  let action: string | null = null;
  const suggestions: AgentSuggestion[] = [];

  if (route.kind === 'deterministic') {
    action = route.action;
    reply = await handleDeterministic(ctx, input, route, term, suggestions);
  } else if (route.kind === 'degraded') {
    degraded = true;
    reply = DEGRADED_REPLY;
    suggestions.push({ kind: 'start_review', label: '开始快速复习' });
    ctx.telemetry.record({
      kind: 'ai.degraded',
      at: now,
      ok: false,
      detail: { reason: route.reason },
    });
  } else {
    const agentContext = await buildAgentContext(ctx, input.learnerId, {
      term,
      session,
      intent: route.intent,
    });
    const history = toLlmHistory(await ctx.repos.chat.listBySession(session.id, 40));
    const startedAt = Date.now();
    try {
      const result = await ctx.llm.complete({
        messages: [
          { role: 'system', content: renderSystemPrompt(agentContext) },
          ...history,
        ],
        temperature: route.task === 'explain' ? 0.3 : 0.8,
        maxOutputTokens: 500,
      });
      reply = result.text;
      usedLlm = true;
      ctx.telemetry.record({
        kind: 'ai.chat',
        at: ctx.clock.nowIso(),
        ok: true,
        latencyMs: result.latencyMs,
        detail: {
          task: route.task,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        },
      });

      if (term) {
        // Optional, non-pushy follow-up (PRD §F-06): offered once, never repeated.
        suggestions.push({ kind: 'save_knowledge', label: `保存「${term}」`, term });
        suggestions.push({ kind: 'micro_practice', label: '做一个 1 分钟小练习', term });
      }
    } catch (error) {
      degraded = true;
      reply = DEGRADED_REPLY;
      suggestions.push({ kind: 'start_review', label: '开始快速复习' });
      ctx.telemetry.record({
        kind: 'ai.chat',
        at: ctx.clock.nowIso(),
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: {
          code: error instanceof DomainError ? error.code : 'unknown',
        },
      });
    }
  }

  const assistantMessage: ChatMessage = {
    id: ctx.ids.next(),
    sessionId: session.id,
    learnerId: input.learnerId,
    role: 'assistant',
    text: reply,
    aiGenerated: usedLlm,
    meta: { term, action, degraded },
    createdAt: ctx.clock.nowIso(),
  };
  await ctx.repos.chat.create(assistantMessage);

  return {
    reply,
    route: route.kind,
    action,
    usedLlm,
    degraded,
    term,
    suggestions,
    messages: await ctx.repos.chat.listBySession(session.id, 200),
  };
}

async function handleDeterministic(
  ctx: AppContext,
  input: AgentTurnInput,
  route: Extract<AgentRoute, { kind: 'deterministic' }>,
  term: string | null,
  suggestions: AgentSuggestion[],
): Promise<string> {
  switch (route.action) {
    case 'disable_correction': {
      await setSessionCorrection(ctx, {
        learnerId: input.learnerId,
        sessionId: input.sessionId,
        enabled: false,
      });
      return '好，这次不纠正你的语法。我们继续聊。';
    }
    case 'enable_correction': {
      await setSessionCorrection(ctx, {
        learnerId: input.learnerId,
        sessionId: input.sessionId,
        enabled: true,
      });
      return '好，我会在影响理解的地方帮你指出来。';
    }
    case 'chat_only': {
      await captureContext(ctx, {
        learnerId: input.learnerId,
        rawInput: input.text,
        intent: 'conversation',
      });
      await recordFeedback(ctx, {
        learnerId: input.learnerId,
        kind: 'chat_only',
        sessionId: input.sessionId,
      });
      return '好的，今天就聊天，不安排练习。想聊点什么？';
    }
    case 'set_time': {
      const minutes = route.minutes ?? null;
      await captureContext(ctx, {
        learnerId: input.learnerId,
        rawInput: input.text,
        availableMinutes: minutes,
      });
      return minutes
        ? `记住了，按 ${minutes} 分钟来安排。首页的推荐会跟着调整。`
        : '好的。';
    }
    case 'start_review': {
      suggestions.push({ kind: 'start_review', label: '开始快速复习' });
      return '可以，点下面的按钮就能开始一次复习。';
    }
    case 'save_this': {
      if (!term) {
        return '想保存哪个表达？用引号把它括起来告诉我，例如「figure out」。';
      }
      const { item, deduplicated } = await createKnowledgeItem(ctx, {
        learnerId: input.learnerId,
        text: term,
        // Language material that came up in a real conversation, not AI-invented.
        origin: 'user',
        sourceType: 'chat_session',
        sourceRef: `session:${input.sessionId}`,
        aiGenerated: false,
      });
      return deduplicated
        ? `「${item.text}」已经在你的知识库里了。`
        : `已保存「${item.text}」到知识库，之后会安排复习。`;
    }
    case 'already_known': {
      if (!term) {
        return '好的，记下来了。是哪个表达你已经掌握了？';
      }
      const normalized = normalizeKnowledgeText('en', term);
      const matches = await ctx.repos.knowledge.search({
        learnerId: input.learnerId,
        text: normalized,
        limit: 1,
      });
      const match = matches[0];
      if (!match) return `好的，「${term}」我不会再推给你了。`;
      const result = await recordFeedback(ctx, {
        learnerId: input.learnerId,
        kind: 'already_known',
        subjectType: 'knowledge_item',
        subjectId: match.id,
        sessionId: input.sessionId,
      });
      return `${result.message}（${match.text}）`;
    }
    case 'reject_recommendation': {
      suggestions.push({ kind: 'navigate', label: '回首页换一个', target: '/' });
      return '没问题，不用解释。回首页可以换一个建议。';
    }
    case 'pause': {
      suggestions.push({ kind: 'navigate', label: '回首页', target: '/' });
      return '已经暂停了，随时回来继续，进度都留着。';
    }
    case 'end': {
      suggestions.push({ kind: 'navigate', label: '回首页', target: '/' });
      return '好的，这次就到这里。记录都保存好了。';
    }
    case 'resume': {
      suggestions.push({ kind: 'navigate', label: '继续上次的学习', target: '/' });
      return '首页上有「继续上次学习」，点它就能接着来。';
    }
    case 'skip': {
      return '跳过这个，没关系。';
    }
    default:
      return '好的。';
  }
}
