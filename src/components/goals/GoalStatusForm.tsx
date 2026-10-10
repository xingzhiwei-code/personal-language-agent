'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { updateGoalAction } from '@/app/actions/learning';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { GoalStatus } from '@/domain/enums';
import type { ActionResult } from '@/server/app';

export function GoalStatusForm({
  goalId,
  status,
  isPrimary,
}: {
  goalId: string;
  status: GoalStatus;
  isPrimary: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateGoalAction,
    null,
  );
  const [confirmingPrimary, setConfirmingPrimary] = useState(false);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="space-y-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="goalId" value={goalId} />
        <div>
          <label htmlFor={`status-${goalId}`} className="block text-xs text-ink-400">
            状态
          </label>
          <select
            id={`status-${goalId}`}
            name="status"
            defaultValue={status}
            className="mt-1 rounded-xl border border-ink-200 px-2.5 py-1.5 text-sm"
          >
            <option value="active">进行中</option>
            <option value="paused">暂停</option>
            <option value="archived">归档</option>
          </select>
        </div>
        <button type="submit" className={buttonStyles.ghost} disabled={pending}>
          {pending ? '…' : '更新'}
        </button>
        {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
      </form>

      {!isPrimary ? (
        confirmingPrimary ? (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="goalId" value={goalId} />
            <input type="hidden" name="makePrimary" value="on" />
            <span className="text-xs text-ink-600">
              切换后今日计划将按新主攻重新生成，各目标进度完整保留。
            </span>
            <button type="submit" className={buttonStyles.primary} disabled={pending} data-testid="confirm-make-primary">
              确认设为主攻
            </button>
            <button type="button" className={buttonStyles.ghost} onClick={() => setConfirmingPrimary(false)}>
              取消
            </button>
          </form>
        ) : (
          <button type="button" className={buttonStyles.ghost} onClick={() => setConfirmingPrimary(true)}>
            设为主攻
          </button>
        )
      ) : null}
    </div>
  );
}
