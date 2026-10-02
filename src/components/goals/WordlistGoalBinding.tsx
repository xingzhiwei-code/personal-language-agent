'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { bindWordlistGoalAction } from '@/app/actions/scenarios';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { Goal, Wordlist } from '@/domain/entities';
import type { ActionResult } from '@/server/app';

export function WordlistGoalBinding({ wordlist, goals }: { wordlist: Wordlist; goals: Goal[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(bindWordlistGoalAction, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-100 p-3">
      <input type="hidden" name="wordlistId" value={wordlist.id} />
      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium">{wordlist.name}</p>
        <p className="text-xs text-ink-400">{wordlist.itemCount} 条 · {wordlist.sourceFile ?? '未知来源'}</p>
      </div>
      <label className="text-xs text-ink-400">
        服务目标
        <select name="goalId" defaultValue={wordlist.goalId ?? ''} className="ml-2 rounded-lg border border-ink-200 px-2 py-1.5 text-sm text-ink-900">
          <option value="">未绑定</option>
          {goals.filter((goal) => goal.status === 'active').map((goal) => (
            <option key={goal.id} value={goal.id}>{goal.isPrimary ? '主攻 · ' : ''}{goal.title}</option>
          ))}
        </select>
      </label>
      <button type="submit" className={buttonStyles.ghost} disabled={pending}>{pending ? '…' : '保存'}</button>
      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
    </form>
  );
}
