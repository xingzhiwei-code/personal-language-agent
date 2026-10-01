'use client';

import { useActionState, useEffect, useState } from 'react';
import { captureContextAction } from '@/app/actions/learning';
import { buttonStyles } from '@/components/ui';
import type { ActionResult } from '@/server/app';

const QUICK_PHRASES = ['我只有 3 分钟', '今天只想聊天', '想复习单词', '我有 15 分钟'];

/**
 * Natural-language shortcut for the current situation.
 * Parsed by local rules — no AI call, no waiting.
 */
export function IntentInput() {
  const [state, action, pending] = useActionState<ActionResult<{
    intent: string;
    minutes: number | null;
  }> | null, FormData>(captureContextAction, null);
  const [text, setText] = useState('');
  const [device, setDevice] = useState('desktop');

  useEffect(() => {
    setDevice(window.matchMedia('(max-width: 640px)').matches ? 'mobile' : 'desktop');
  }, []);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="device" value={device} />
      <label htmlFor="intent-text" className="block text-sm font-medium text-ink-900">
        现在的情况是？
      </label>
      <div className="flex gap-2">
        <input
          id="intent-text"
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="例如：我只有 3 分钟 / 今天只想聊天"
          className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-ink-400"
          maxLength={200}
        />
        <button type="submit" className={buttonStyles.secondary} disabled={pending}>
          {pending ? '…' : '告诉它'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => setText(phrase)}
            className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
          >
            {phrase}
          </button>
        ))}
      </div>

      {state ? (
        <p
          role="status"
          className={`text-xs ${state.ok ? 'text-accent-600' : 'text-red-600'}`}
        >
          {state.message}
        </p>
      ) : (
        <p className="text-xs text-ink-400">
          推荐会跟着你的时间和意图变化。这一步完全在本地完成，不调用 AI。
        </p>
      )}
    </form>
  );
}
