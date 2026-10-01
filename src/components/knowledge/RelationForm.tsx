'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { addRelationAction } from '@/app/actions/knowledge';
import { RELATION_LABELS } from '@/components/labels';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { KnowledgeRelationType } from '@/domain/enums';
import type { ActionResult } from '@/server/app';

const TYPES: KnowledgeRelationType[] = [
  'related',
  'derived_from',
  'variant_of',
  'contrasts_with',
  'commonly_used_with',
  'part_of',
  'example_of',
];

export function RelationForm({
  fromItemId,
  candidates,
}: {
  fromItemId: string;
  candidates: { id: string; text: string }[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addRelationAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (candidates.length === 0) {
    return <p className="text-xs text-ink-400">再添加一条知识后就可以建立关系了。</p>;
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="fromItemId" value={fromItemId} />
      <div className="min-w-[160px] flex-1">
        <label htmlFor="relation-target" className="block text-xs text-ink-400">
          关联到
        </label>
        <select
          id="relation-target"
          name="toItemId"
          className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm"
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.text}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="relation-type" className="block text-xs text-ink-400">
          关系
        </label>
        <select
          id="relation-type"
          name="type"
          defaultValue="related"
          className="mt-1 rounded-xl border border-ink-200 px-3 py-2 text-sm"
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {RELATION_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={buttonStyles.secondary} disabled={pending}>
        {pending ? '添加中…' : '添加关系'}
      </button>
      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
    </form>
  );
}
