'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runAgentTurn, type AgentSuggestion } from '@/agent/chat';
import { createKnowledgeItem } from '@/application/knowledge';
import { setSessionCorrection, startSession } from '@/application/sessions';
import { app, toActionError, type ActionResult } from '@/server/app';

/** Starts (or reuses) a free-chat session and navigates into it. */
export async function startChatAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const clientToken = String(formData.get('clientToken') ?? `chat-${Date.now()}`);
  const { session } = await startSession(ctx, {
    learnerId,
    activityType: 'conversation',
    plannedDurationMinutes: null,
    clientToken,
  });
  revalidatePath('/');
  redirect(`/chat/${session.id}`);
}

export interface ChatTurnData {
  reply: string;
  usedLlm: boolean;
  degraded: boolean;
  route: string;
  action: string | null;
  term: string | null;
  suggestions: AgentSuggestion[];
}

export async function sendChatMessageAction(
  _prev: ActionResult<ChatTurnData> | null,
  formData: FormData,
): Promise<ActionResult<ChatTurnData>> {
  const { ctx, learnerId } = app();
  const sessionId = String(formData.get('sessionId') ?? '');
  const text = String(formData.get('text') ?? '').trim();
  const lastTerm = formData.get('lastTerm') ? String(formData.get('lastTerm')) : null;

  if (text.length === 0) return { ok: false, message: '请输入内容' };

  try {
    const result = await runAgentTurn(ctx, { learnerId, sessionId, text, lastTerm });
    revalidatePath(`/chat/${sessionId}`);
    return {
      ok: true,
      data: {
        reply: result.reply,
        usedLlm: result.usedLlm,
        degraded: result.degraded,
        route: result.route,
        action: result.action,
        term: result.term,
        suggestions: result.suggestions,
      },
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function toggleCorrectionAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const sessionId = String(formData.get('sessionId') ?? '');
  await setSessionCorrection(ctx, {
    learnerId,
    sessionId,
    enabled: String(formData.get('enabled') ?? 'true') === 'true',
  });
  revalidatePath(`/chat/${sessionId}`);
}

/** "保存这个" from the chat suggestions. */
export async function saveTermAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, learnerId } = app();
  const term = String(formData.get('term') ?? '').trim();
  const sessionId = String(formData.get('sessionId') ?? '');
  if (term.length === 0) return { ok: false, message: '没有可保存的表达' };

  try {
    const { item, deduplicated } = await createKnowledgeItem(ctx, {
      learnerId,
      text: term,
      origin: 'user',
      sourceType: 'chat_session',
      sourceRef: `session:${sessionId}`,
      aiGenerated: false,
    });
    revalidatePath('/knowledge');
    return {
      ok: true,
      message: deduplicated ? `「${item.text}」已经在知识库里` : `已保存「${item.text}」`,
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}
