'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { createGoalAction } from '@/app/actions/learning';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

const EXAMPLES = [
  '我想提高英语口语',
  '我想能听懂英文技术会议',
  '我想练好写英文邮件',
  '我想为面试准备英语对话',
];

/**
 * Onboarding: one sentence is enough. No long questionnaire, and creating a
 * goal never requires an AI key (parsing is rule-based).
 */
export function GoalForm({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult<{ goalId: string }> | null, FormData>(
    createGoalAction,
    null,
  );
  const [text, setText] = useState('');

  useEffect(() => {
    if (state?.ok) {
      router.push(redirectTo);
      router.refresh();
    }
  }, [state, router, redirectTo]);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="goal-text" className="block text-sm font-medium text-ink-900">
          你想达到什么？
        </label>
        <p className="mt-0.5 text-xs text-ink-400">用一句自己的话说就行，之后随时可以改。</p>
        <textarea
          id="goal-text"
          name="text"
          required
          rows={3}
          maxLength={500}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="例如：我想提高英语口语"
          className="mt-2 w-full resize-none rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setText(example)}
            className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
          >
            {example}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="goal-minutes" className="block text-sm font-medium text-ink-900">
          每次大概能学多久？（可跳过）
        </label>
        <select
          id="goal-minutes"
          name="minutes"
          className="mt-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm"
          defaultValue=""
        >
          <option value="">先不填</option>
          <option value="3">3 分钟</option>
          <option value="5">5 分钟</option>
          <option value="10">10 分钟</option>
          <option value="20">20 分钟</option>
        </select>
      </div>

      <div>
        <label htmlFor="goal-type" className="block text-sm font-medium text-ink-900">
          目标分类
        </label>
        <p className="mt-0.5 text-xs text-ink-400">决定把目标拆成哪种阶段。留空会自动识别。</p>
        <select
          id="goal-type"
          name="goalType"
          className="mt-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm"
          defaultValue=""
        >
          <option value="">自动识别</option>
          <option value="ielts">雅思备考</option>
          <option value="general">通用</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" name="makePrimary" className="rounded border-ink-200" />
        创建后设为主攻（默认不抢主攻，先放着）
      </label>

      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}

      <button
        type="submit"
        className={buttonStyles.primary}
        disabled={pending || text.trim().length === 0}
        data-testid="create-goal"
      >
        {pending ? '正在创建…' : '创建目标并开始'}
      </button>
    </form>
  );
}
