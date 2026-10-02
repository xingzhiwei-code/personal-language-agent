'use client';

import { useActionState } from 'react';
import { createKnowledgeAction } from '@/app/actions/knowledge';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

export function SourceManualAdd({ sourceId, languageCode }: { sourceId: string; languageCode: string }) {
  const [state, action, pending] = useActionState<
    ActionResult<{ id: string; deduplicated: boolean }> | null,
    FormData
  >(createKnowledgeAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="languageCode" value={languageCode} />
      <input type="hidden" name="type" value="auto" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          表达
          <input name="text" required maxLength={400} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm" />
        </label>
        <label className="text-sm font-medium">
          释义
          <input name="meaning" maxLength={2000} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm" />
        </label>
      </div>
      <label className="block text-sm font-medium">
        例句（可从上方原文复制）
        <input name="example" maxLength={600} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm" />
      </label>
      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
      {state?.ok ? <p role="status" className="text-sm text-accent-600">{state.message}</p> : null}
      <button type="submit" className={buttonStyles.primary} disabled={pending}>
        {pending ? '保存中…' : '从原文添加表达'}
      </button>
    </form>
  );
}
