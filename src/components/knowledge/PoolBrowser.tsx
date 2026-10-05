'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { promoteKnowledgeBatchAction } from '@/app/actions/knowledge';
import { bindItemsToScenarioAction } from '@/app/actions/scenarios';
import { KNOWLEDGE_TYPE_LABELS } from '@/components/labels';
import { Badge, buttonStyles, ErrorNote } from '@/components/ui';
import type { KnowledgeItem, LearnerState } from '@/domain/entities';
import type { ActionResult } from '@/server/app';

export interface ScenarioOption {
  id: string;
  name: string;
}

export function PoolBrowser({
  entries,
  wordlistNames,
  scenarios = [],
}: {
  entries: { item: KnowledgeItem; state: LearnerState | null }[];
  wordlistNames: Record<string, string>;
  scenarios?: ScenarioOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [scenarioId, setScenarioId] = useState<string>('');
  const [promoteState, promoteAction, promoting] = useActionState<
    ActionResult<{ count: number }> | null,
    FormData
  >(promoteKnowledgeBatchAction, null);
  const [bindState, bindAction, binding] = useActionState<
    ActionResult<{ count: number }> | null,
    FormData
  >(bindItemsToScenarioAction, null);

  useEffect(() => {
    if (promoteState?.ok || bindState?.ok) {
      setSelected([]);
      setScenarioId('');
      router.refresh();
    }
  }, [promoteState, bindState, router]);

  return (
    <form action={promoteAction} className="space-y-3">
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
        <div className="flex flex-wrap items-center gap-2">
          {scenarios.length > 0 ? (
            <select
              name="scenarioId"
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
              className="rounded-xl border border-ink-200 px-2 py-2 text-sm"
              aria-label="选择场景"
            >
              <option value="">绑定到场景…</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </select>
          ) : null}
          {scenarios.length > 0 ? (
            <button
              type="submit"
              formAction={bindAction}
              className={buttonStyles.secondary}
              disabled={binding || selected.length === 0 || scenarioId === ''}
            >
              {binding ? '绑定中…' : '绑定到场景'}
            </button>
          ) : null}
          <button
            type="submit"
            formAction={promoteAction}
            className={buttonStyles.primary}
            disabled={promoting || selected.length === 0}
          >
            {promoting ? '正在加入…' : '加入学习'}
          </button>
        </div>
      </div>
      {selected.map((id) => (
        <input key={id} type="hidden" name="itemId" value={id} />
      ))}
      {promoteState && !promoteState.ok ? <ErrorNote>{promoteState.message}</ErrorNote> : null}
      {bindState && !bindState.ok ? <ErrorNote>{bindState.message}</ErrorNote> : null}
      {promoteState?.ok || bindState?.ok ? (
        <p role="status" className="text-sm text-accent-600">
          {promoteState?.message ?? bindState?.message}
        </p>
      ) : null}
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
