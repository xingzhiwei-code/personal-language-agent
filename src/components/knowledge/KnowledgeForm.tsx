'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { createKnowledgeAction } from '@/app/actions/knowledge';
import { KNOWLEDGE_TYPE_LABELS } from '@/components/labels';
import { buttonStyles, Card, ErrorNote } from '@/components/ui';
import type { KnowledgeType } from '@/domain/enums';
import type { ActionResult } from '@/server/app';

const TYPES: (KnowledgeType | 'auto')[] = [
  'auto',
  'word',
  'phrase',
  'chunk',
  'sentence',
  'pattern',
  'grammar',
  'expression',
  'concept',
];

/**
 * Manual knowledge entry. `figure` and `figure out` stay separate items
 * because de-duplication is scoped by type + normalised text.
 */
export function KnowledgeForm({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState<
    ActionResult<{ id: string; deduplicated: boolean }> | null,
    FormData
  >(createKnowledgeAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (!open) {
    return (
      <button
        type="button"
        className={buttonStyles.primary}
        onClick={() => setOpen(true)}
        data-testid="open-knowledge-form"
      >
        添加知识条目
      </button>
    );
  }

  return (
    <Card>
      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="k-text" className="block text-sm font-medium">
              表达 *
            </label>
            <input
              id="k-text"
              name="text"
              required
              maxLength={400}
              placeholder="figure out"
              className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
              data-testid="knowledge-text"
            />
          </div>
          <div>
            <label htmlFor="k-meaning" className="block text-sm font-medium">
              释义
            </label>
            <input
              id="k-meaning"
              name="meaning"
              maxLength={2000}
              placeholder="弄清楚"
              className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
              data-testid="knowledge-meaning"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="k-type" className="block text-sm font-medium">
              类型
            </label>
            <select
              id="k-type"
              name="type"
              defaultValue="auto"
              className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'auto' ? '自动判断' : KNOWLEDGE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="k-language" className="block text-sm font-medium">
              语言
            </label>
            <select
              id="k-language"
              name="languageCode"
              defaultValue="en"
              className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
            >
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="k-example" className="block text-sm font-medium">
            例句（来自你真实遇到的内容更好）
          </label>
          <input
            id="k-example"
            name="example"
            maxLength={600}
            placeholder="I need to figure out the schedule."
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
          />
        </div>

        {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
        {state?.ok ? (
          <p role="status" className="text-sm text-accent-600">
            {state.message}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            className={buttonStyles.primary}
            disabled={pending}
            data-testid="submit-knowledge"
          >
            {pending ? '保存中…' : '保存'}
          </button>
          <button type="button" className={buttonStyles.ghost} onClick={() => setOpen(false)}>
            收起
          </button>
        </div>
        <p className="text-xs text-ink-400">
          手动添加的条目来源记为「我手动添加」；AI 生成的内容会单独标记，不会混在一起。
        </p>
      </form>
    </Card>
  );
}
