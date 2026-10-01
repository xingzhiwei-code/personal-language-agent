'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { updateKnowledgeAction } from '@/app/actions/knowledge';
import { KNOWLEDGE_TYPE_LABELS, STATUS_LABELS } from '@/components/labels';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { KnowledgeItem } from '@/domain/entities';
import type { KnowledgeStatus, KnowledgeType } from '@/domain/enums';
import type { ActionResult } from '@/server/app';

const TYPES: KnowledgeType[] = [
  'word',
  'phrase',
  'chunk',
  'sentence',
  'pattern',
  'grammar',
  'pronunciation',
  'expression',
  'concept',
];

const STATUSES: KnowledgeStatus[] = ['active', 'user_mastered', 'irrelevant', 'archived'];

export function KnowledgeEditor({ item }: { item: KnowledgeItem }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateKnowledgeAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={item.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-text" className="block text-xs text-ink-400">
            表达
          </label>
          <input
            id="edit-text"
            name="text"
            defaultValue={item.text}
            maxLength={400}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="edit-type" className="block text-xs text-ink-400">
            类型
          </label>
          <select
            id="edit-type"
            name="type"
            defaultValue={item.type}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {KNOWLEDGE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="edit-meaning" className="block text-xs text-ink-400">
          释义
        </label>
        <input
          id="edit-meaning"
          name="meaning"
          defaultValue={item.meaning ?? ''}
          maxLength={2000}
          className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
          data-testid="edit-meaning"
        />
      </div>

      <div>
        <label htmlFor="edit-notes" className="block text-xs text-ink-400">
          备注
        </label>
        <textarea
          id="edit-notes"
          name="notes"
          rows={2}
          defaultValue={item.notes ?? ''}
          maxLength={2000}
          className="mt-1 w-full resize-none rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <label htmlFor="edit-status" className="block text-xs text-ink-400">
          状态（你可以纠正系统的判断）
        </label>
        <select
          id="edit-status"
          name="status"
          defaultValue={item.status}
          className="mt-1 rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
          data-testid="edit-status"
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-accent-600">
          {state.message}
        </p>
      ) : null}

      <button type="submit" className={buttonStyles.secondary} disabled={pending}>
        {pending ? '保存中…' : '保存修改'}
      </button>
    </form>
  );
}
