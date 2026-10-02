'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import {
  pauseKnowledgeBatchAction,
  promoteKnowledgeBatchAction,
} from '@/app/actions/knowledge';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { KnowledgeStatus } from '@/domain/enums';
import type { ActionResult } from '@/server/app';

export function KnowledgeFlowControls({ id, status }: { id: string; status: KnowledgeStatus }) {
  const router = useRouter();
  const action = status === 'new' ? promoteKnowledgeBatchAction : pauseKnowledgeBatchAction;
  const [state, submit, pending] = useActionState<ActionResult<{ count: number }> | null, FormData>(
    action,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  if (status !== 'new' && status !== 'active') return null;

  return (
    <form action={submit} className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-ink-50 p-3">
      <input type="hidden" name="itemId" value={id} />
      <button type="submit" className={status === 'new' ? buttonStyles.primary : buttonStyles.secondary} disabled={pending}>
        {pending ? '处理中…' : status === 'new' ? '加入学习' : '暂停并放回词库池'}
      </button>
      <span className="text-xs text-ink-400">
        {status === 'new' ? '加入后会创建复习安排。' : '历史掌握记录保留，但不再进入到期队列。'}
      </span>
      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
    </form>
  );
}
