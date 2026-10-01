'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { deleteDataAction, saveExportAction } from '@/app/actions/data';
import { buttonStyles, ErrorNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

export function DataControls({ confirmPhrase }: { confirmPhrase: string }) {
  const router = useRouter();
  const [exportState, exportAction, exporting] = useActionState<
    ActionResult<{ key: string; bytes: number }> | null,
    FormData
  >(() => saveExportAction(null), null);
  const [deleteState, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(
    deleteDataAction,
    null,
  );
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (deleteState?.ok) {
      setConfirmation('');
      router.refresh();
    }
  }, [deleteState, router]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">导出数据</p>
        <p className="text-xs text-ink-600">
          导出为可读的 JSON，包含目标、知识、事件、评估、状态、记忆与偏好。
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export" className={buttonStyles.primary} download>
            下载 JSON
          </a>
          <form action={exportAction}>
            <button type="submit" className={buttonStyles.secondary} disabled={exporting}>
              {exporting ? '导出中…' : '保存到本地目录'}
            </button>
          </form>
        </div>
        {exportState?.message ? (
          <p role="status" className="text-xs text-accent-600">
            {exportState.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-ink-100 pt-5">
        <p className="text-sm font-medium text-red-700">删除本地学习数据</p>
        <p className="text-xs text-ink-600">
          这个操作不可撤销：目标、知识、事件、评估、状态和对话都会被删除。导出的文件也会一起清理。
        </p>
        <form action={deleteAction} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="confirm" className="block text-xs text-ink-400">
              输入「{confirmPhrase}」以确认
            </label>
            <input
              id="confirm"
              name="confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1 rounded-xl border border-ink-200 px-3 py-2 text-sm"
              data-testid="delete-confirm-input"
            />
          </div>
          <button
            type="submit"
            className={buttonStyles.danger}
            disabled={deleting || confirmation !== confirmPhrase}
            data-testid="delete-data"
          >
            {deleting ? '删除中…' : '删除'}
          </button>
        </form>
        {deleteState && !deleteState.ok ? <ErrorNote>{deleteState.message}</ErrorNote> : null}
        {deleteState?.ok ? (
          <p role="status" className="text-xs text-accent-600">
            {deleteState.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
