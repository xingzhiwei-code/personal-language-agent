'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  saveTermAction,
  sendChatMessageAction,
  type ChatTurnData,
} from '@/app/actions/chat';
import { startSessionAction } from '@/app/actions/learning';
import { Badge, buttonStyles, ErrorNote } from '@/components/ui';
import type { ChatMessage } from '@/domain/entities';
import type { ActionResult } from '@/server/app';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  aiGenerated: boolean;
}

/**
 * Free chat. Commands like "不要纠正我的语法" are handled locally and instantly;
 * only real conversation reaches the model.
 */
export function ChatPanel({
  sessionId,
  initialMessages,
  correctionEnabled,
  aiAvailable,
}: {
  sessionId: string;
  initialMessages: ChatMessage[];
  correctionEnabled: boolean;
  aiAvailable: boolean;
}) {
  const [messages, setMessages] = useState<LocalMessage[]>(
    initialMessages.map((message) => ({
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: message.text,
      aiGenerated: message.aiGenerated,
    })),
  );
  const [state, action, pending] = useActionState<ActionResult<ChatTurnData> | null, FormData>(
    sendChatMessageAction,
    null,
  );
  const [text, setText] = useState('');
  const [lastTerm, setLastTerm] = useState<string | null>(null);
  const [correction, setCorrection] = useState(correctionEnabled);
  const [saveState, saveDispatch] = useActionState<ActionResult | null, FormData>(
    saveTermAction,
    null,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const handled = useRef<ActionResult<ChatTurnData> | null>(null);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok && state.data) {
      setMessages((previous) => [
        ...previous,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: state.data!.reply,
          aiGenerated: state.data!.usedLlm,
        },
      ]);
      if (state.data.term) setLastTerm(state.data.term);
      if (state.data.action === 'disable_correction') setCorrection(false);
      if (state.data.action === 'enable_correction') setCorrection(true);
    }
  }, [state]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending]);

  const suggestions = state?.ok ? (state.data?.suggestions ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
        <Badge tone={correction ? 'accent' : 'neutral'}>
          {correction ? '纠错已开启' : '本次不纠错'}
        </Badge>
        {!aiAvailable ? <Badge tone="warn">未配置 AI</Badge> : null}
        <span>可以直接说「不要纠正我的语法」或「今天只想聊天」。</span>
      </div>

      <div
        ref={listRef}
        className="max-h-[52vh] min-h-[220px] space-y-3 overflow-y-auto rounded-2xl border border-ink-200 bg-white p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-ink-400">
            随便聊点什么，或者问一个语言问题，例如：What does &ldquo;figure out&rdquo; mean?
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-accent-500 text-white'
                    : 'bg-ink-100 text-ink-900'
                }`}
              >
                {message.text}
                {message.role === 'assistant' && message.aiGenerated ? (
                  <span className="mt-1 block text-[10px] text-ink-400">AI 生成</span>
                ) : null}
              </div>
            </div>
          ))
        )}
        {pending ? <p className="text-xs text-ink-400">正在回复…</p> : null}
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => {
            if (suggestion.kind === 'save_knowledge' && suggestion.term) {
              return (
                <form key={suggestion.label} action={saveDispatch}>
                  <input type="hidden" name="term" value={suggestion.term} />
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <button type="submit" className={buttonStyles.secondary}>
                    {suggestion.label}
                  </button>
                </form>
              );
            }
            if (suggestion.kind === 'start_review' || suggestion.kind === 'micro_practice') {
              return (
                <form key={suggestion.label} action={startSessionAction}>
                  <input type="hidden" name="activityType" value="quick_review" />
                  <input
                    type="hidden"
                    name="minutes"
                    value={suggestion.kind === 'micro_practice' ? 1 : 5}
                  />
                  <input
                    type="hidden"
                    name="clientToken"
                    value={`chat-suggest-${sessionId}-${suggestion.kind}`}
                  />
                  <button type="submit" className={buttonStyles.secondary}>
                    {suggestion.label}
                  </button>
                </form>
              );
            }
            return null;
          })}
        </div>
      ) : null}

      {saveState?.message ? (
        <p role="status" className="text-xs text-accent-600">
          {saveState.message}
        </p>
      ) : null}

      <form
        action={(formData) => {
          const value = String(formData.get('text') ?? '').trim();
          if (value.length > 0) {
            setMessages((previous) => [
              ...previous,
              { id: `user-${Date.now()}`, role: 'user', text: value, aiGenerated: false },
            ]);
            setText('');
          }
          action(formData);
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="lastTerm" value={lastTerm ?? ''} />
        <input
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="说点什么…"
          aria-label="输入消息"
          className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none"
          maxLength={2000}
          data-testid="chat-input"
        />
        <button
          type="submit"
          className={buttonStyles.primary}
          disabled={pending || text.trim().length === 0}
          data-testid="chat-send"
        >
          发送
        </button>
      </form>

      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
    </div>
  );
}
