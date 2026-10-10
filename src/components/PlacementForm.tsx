'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import {
  overridePlacementAction,
  selfReportPlacementAction,
} from '@/app/actions/learning';
import { SELF_REPORT_OPTIONS } from '@/application/placement';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

/**
 * Self-report (6 levels + optional note) and manual override, both with inline
 * error display. The starting level is the user's to decide (宪法#2).
 */
export function PlacementForm() {
  const router = useRouter();
  const [selfState, selfAction, selfPending] = useActionState<ActionResult | null, FormData>(
    selfReportPlacementAction,
    null,
  );
  const [overrideState, overrideAction, overridePending] = useActionState<
    ActionResult | null,
    FormData
  >(overridePlacementAction, null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (selfState?.ok || overrideState?.ok) router.refresh();
  }, [selfState, overrideState, router]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-medium text-ink-900">自述当前水平</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          不做测试也行。选一个最接近的，系统会标为“低置信度”，之后可以随时重测或调整。
        </p>
        <form action={selfAction} className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {SELF_REPORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="submit"
                name="value"
                value={option.value}
                disabled={selfPending}
                className={buttonStyles.secondary}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="placement-note" className="block text-xs text-ink-400">
              备注（可选，如“考过四级，多年没碰”）
            </label>
            <textarea
              id="placement-note"
              name="note"
              rows={2}
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1.5 w-full resize-none rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-ink-400"
            />
          </div>
          {selfState && !selfState.ok ? <ErrorNote>{selfState.message}</ErrorNote> : null}
        </form>
      </section>

      <section className="border-t border-ink-100 pt-5">
        <h2 className="text-sm font-medium text-ink-900">手动调整起点</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          以 0–9 分（对齐雅思分数）为准。你拥有最终决定权，覆盖会记为“override”。
        </p>
        <form action={overrideAction} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="placement-level" className="block text-xs text-ink-400">
              起点分数
            </label>
            <input
              id="placement-level"
              name="level"
              type="number"
              min={0}
              max={9}
              step={0.5}
              required
              className="mt-1.5 w-28 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none"
            />
          </div>
          <button type="submit" className={buttonStyles.secondary} disabled={overridePending}>
            {overridePending ? '保存中…' : '覆盖起点'}
          </button>
          {overrideState && !overrideState.ok ? <ErrorNote>{overrideState.message}</ErrorNote> : null}
        </form>
      </section>
    </div>
  );
}
