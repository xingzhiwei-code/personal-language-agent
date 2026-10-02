'use client';

import { useActionState } from 'react';
import { updateDailyNewWordBudgetAction } from '@/app/actions/data';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

export function NewWordBudgetForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateDailyNewWordBudgetAction,
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-ink-600">
          每天最多自动加入
          <span className="ml-2 inline-flex items-center gap-2">
            <input
              name="budget"
              type="number"
              min={0}
              max={50}
              step={1}
              required
              defaultValue={value}
              className="w-20 rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
            个新词
          </span>
        </label>
        <button type="submit" className={buttonStyles.secondary} disabled={pending}>
          {pending ? '保存中…' : '保存预算'}
        </button>
      </div>
      <p className="text-xs text-ink-400">范围 0–50；设为 0 会关闭自动加入，但仍可在词库池手动选择。</p>
      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
      {state?.ok ? <p role="status" className="text-sm text-accent-600">{state.message}</p> : null}
    </form>
  );
}
