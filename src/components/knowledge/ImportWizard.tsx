'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  confirmKnowledgeFileImportAction,
  previewKnowledgeFileAction,
} from '@/app/actions/import';
import type { FileImportPreview, FileImportResult } from '@/application/importer';
import { Badge, buttonStyles, Card, ErrorNote, InfoNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

interface GoalOption {
  id: string;
  title: string;
  isPrimary: boolean;
}

export function ImportWizard({ goals }: { goals: GoalOption[] }) {
  const [previewState, previewAction, previewPending] = useActionState<
    ActionResult<FileImportPreview> | null,
    FormData
  >(previewKnowledgeFileAction, null);
  const [resultState, confirmAction, confirmPending] = useActionState<
    ActionResult<FileImportResult> | null,
    FormData
  >(confirmKnowledgeFileImportAction, null);
  const preview = previewState?.ok ? previewState.data : undefined;
  const result = resultState?.ok ? resultState.data : undefined;

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-4 flex items-center gap-2 text-xs text-ink-400">
          <Badge tone={!preview ? 'accent' : 'neutral'}>1 上传</Badge>
          <span>→</span>
          <Badge tone={preview && !result ? 'accent' : 'neutral'}>2 预览确认</Badge>
          <span>→</span>
          <Badge tone={result ? 'accent' : 'neutral'}>3 结果</Badge>
        </div>
        <form action={previewAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div>
              <label htmlFor="import-file" className="block text-sm font-medium">
                词库文件
              </label>
              <input
                id="import-file"
                name="file"
                type="file"
                required
                accept=".csv,.json,.txt,text/csv,application/json,text/plain"
                className="mt-1 block w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-sm"
              />
              <p className="mt-1 text-xs text-ink-400">UTF-8 编码，最多 20,000 条、10 MB</p>
            </div>
            <div>
              <label htmlFor="import-language" className="block text-sm font-medium">
                语言
              </label>
              <select
                id="import-language"
                name="languageCode"
                defaultValue="en"
                className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
              >
                <option value="en">英语</option>
                <option value="ja">日语</option>
                <option value="ko">韩语</option>
                <option value="fr">法语</option>
                <option value="de">德语</option>
                <option value="es">西班牙语</option>
              </select>
            </div>
          </div>
          {previewState && !previewState.ok ? <ErrorNote>{previewState.message}</ErrorNote> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonStyles.primary} disabled={previewPending}>
              {previewPending ? '正在解析…' : preview ? '重新预览' : '解析并预览'}
            </button>
            <Link href="/samples/sample-wordlist.csv" className="text-sm text-accent-600 underline">
              下载格式示例
            </Link>
          </div>
        </form>
      </Card>

      {preview ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">预览：{preview.fileName}</h2>
              <p className="mt-1 text-sm text-ink-600">
                共 {preview.totalCount} 条 · 预计新增 {preview.estimatedAddedCount} 条
                {preview.estimatedCompletedCount > 0 ? <> · 补全 {preview.estimatedCompletedCount} 条</> : null}
                {' '}· 重复 {preview.duplicateCount} 条 · 失败 {preview.failedCount} 条
              </p>
            </div>
            <Badge tone={preview.duplicateFile ? 'warn' : 'accent'}>
              {preview.duplicateFile ? '已导入过' : preview.format.toUpperCase()}
            </Badge>
          </div>

          {preview.duplicateFile ? (
            <div className="mt-4">
              <InfoNote>文件哈希与已有导入记录一致。为保证幂等，本次不会写入任何数据。</InfoNote>
            </div>
          ) : null}

          {preview.entries.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-ink-50 text-xs text-ink-600">
                  <tr>
                    <th className="px-3 py-2">行</th>
                    <th className="px-3 py-2">词 / 表达</th>
                    <th className="px-3 py-2">音标</th>
                    <th className="px-3 py-2">词性</th>
                    <th className="px-3 py-2">释义</th>
                    <th className="px-3 py-2">例句</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {preview.entries.map((entry) => (
                    <tr key={`${entry.row}-${entry.word}`}>
                      <td className="px-3 py-2 text-ink-400">{entry.row}</td>
                      <td className="px-3 py-2 font-medium">{entry.word}</td>
                      <td className="px-3 py-2 text-ink-600">{entry.phonetic ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-600">{entry.pos ?? '—'}</td>
                      <td className="max-w-52 truncate px-3 py-2 text-ink-600">
                        {entry.definition ?? '—'}
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 text-ink-600">
                        {entry.example ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.totalCount > preview.entries.length ? (
            <p className="mt-2 text-xs text-ink-400">仅展示前 20 条，确认后会处理全部内容。</p>
          ) : null}
          {preview.errors.length > 0 ? (
            <details className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <summary>查看解析失败明细（最多 50 条）</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.errors.map((error) => (
                  <li key={`${error.row}-${error.reason}`}>第 {error.row} 行：{error.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {!preview.duplicateFile && preview.validCount > 0 ? (
            <form action={confirmAction} className="mt-5 space-y-4 border-t border-ink-100 pt-4">
              <input type="hidden" name="fileHash" value={preview.fileHash} />
              <input type="hidden" name="fileName" value={preview.fileName} />
              <input type="hidden" name="format" value={preview.format} />
              <input type="hidden" name="languageCode" value={preview.languageCode} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="wordlist-name" className="block text-sm font-medium">
                    词库名称
                  </label>
                  <input
                    id="wordlist-name"
                    name="wordlistName"
                    required
                    maxLength={120}
                    defaultValue={preview.fileName.replace(/\.[^.]+$/, '')}
                    className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="import-goal" className="block text-sm font-medium">
                    服务目标（可选）
                  </label>
                  <select
                    id="import-goal"
                    name="goalId"
                    defaultValue=""
                    className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
                  >
                    <option value="">暂不绑定</option>
                    {goals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.isPrimary ? '主攻 · ' : ''}{goal.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-600">
                <input type="checkbox" name="aiGenerated" className="rounded border-ink-200" />
                这个文件是 AI 生成的（释义/例句会标注 AI 生成）
              </label>
              {confirmPending && preview.largeImport ? (
                <div role="status" className="space-y-1">
                  <progress className="h-2 w-full" />
                  <p className="text-xs text-ink-600">正在事务性写入 {preview.totalCount} 条数据，请勿关闭页面…</p>
                </div>
              ) : null}
              {resultState && !resultState.ok ? <ErrorNote>{resultState.message}</ErrorNote> : null}
              <button type="submit" className={buttonStyles.primary} disabled={confirmPending}>
                {confirmPending ? '正在导入…' : '确认导入词库池'}
              </button>
              <p className="text-xs text-ink-400">导入条目先进入词库池，不会立即加入复习队列。</p>
            </form>
          ) : null}
        </Card>
      ) : null}

      {result ? (
        <Card className="border-accent-100 bg-accent-50">
          <h2 className="font-semibold text-accent-600">{result.duplicateFile ? '未重复导入' : '导入完成'}</h2>
          <p className="mt-2 text-sm text-ink-600">
            新增 {result.addedCount} 条，补全 {result.completedCount} 条，重复跳过 {result.duplicateCount} 条，失败 {result.failedCount} 条。
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/knowledge?status=pool" className={buttonStyles.primary}>查看词库池</Link>
            <Link href="/knowledge" className={buttonStyles.secondary}>返回知识库</Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
