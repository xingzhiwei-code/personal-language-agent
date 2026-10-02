'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { promoteKnowledgeBatchAction } from '@/app/actions/knowledge';
import { KNOWLEDGE_TYPE_LABELS } from '@/components/labels';
import { Badge, buttonStyles, ErrorNote } from '@/components/ui';
import type { KnowledgeItem, LearnerState } from '@/domain/entities';
import type { ActionResult } from '@/server/app';

export function PoolBrowser({
  entries,
  wordlistNames,
}: {
  entries: { item: KnowledgeItem; state: LearnerState | null }[];
  wordlistNames: Record<string, string>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action, pending] = useActionState<ActionResult<{ count: number }> | null, FormData>(
    promoteKnowledgeBatchAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) {
      setSelected([]);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-3">
      <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={entries.length > 0 && selected.length === entries.length}
            onChange={(event) => setSelected(event.target.checked ? entries.map(({ item }) => item.id) : [])}
            className="rounded border-ink-200"
          />
          全选本页（已选 {selected.length} 条）
        </label>
        <button type="submit" className={buttonStyles.primary} disabled={pending || selected.length === 0}>
          {pending ? '正在加入…' : '加入学习'}
        </button>
      </div>
      {selected.map((id) => <input key={id} type="hidden" name="itemId" value={id} />)}
      {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
      {state?.ok ? <p role="status" className="text-sm text-accent-600">{state.message}</p> : null}
      <ul className="space-y-2">
        {entries.map(({ item }) => (
          <li key={item.id} className="flex items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4">
            <input
              type="checkbox"
              aria-label={`选择 ${item.text}`}
              checked={selected.includes(item.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
              className="mt-1 rounded border-ink-200"
            />
            <Link href={`/knowledge/${item.id}`} className="min-w-0 flex-1 hover:text-accent-600">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.text}</span>
                <Badge>{KNOWLEDGE_TYPE_LABELS[item.type]}</Badge>
                {item.wordlistId && wordlistNames[item.wordlistId] ? <Badge tone="accent">{wordlistNames[item.wordlistId]}</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-ink-600">{item.meaning ?? '还没有释义'}</p>
              {item.tags.length > 0 ? <p className="mt-1 text-xs text-ink-400">标签：{item.tags.join('、')}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </form>
  );
}
