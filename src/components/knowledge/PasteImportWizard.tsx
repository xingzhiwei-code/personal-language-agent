'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import {
  confirmPastedCandidatesAction,
  extractPastedTextAction,
} from '@/app/actions/paste-import';
import type {
  ConfirmPasteImportResult,
  ExtractedPasteCandidate,
  PasteExtractionPreview,
} from '@/application/paste-import';
import { Badge, buttonStyles, Card, ErrorNote, InfoNote } from '@/components/ui';
import type { ActionResult } from '@/server/app';

type EditableCandidate = ExtractedPasteCandidate & { selected: boolean };

export function PasteImportWizard({ aiConfigured }: { aiConfigured: boolean }) {
  const [previewState, extractAction, extracting] = useActionState<
    ActionResult<PasteExtractionPreview> | null,
    FormData
  >(extractPastedTextAction, null);
  const [resultState, confirmAction, confirming] = useActionState<
    ActionResult<ConfirmPasteImportResult> | null,
    FormData
  >(confirmPastedCandidatesAction, null);
  const [candidates, setCandidates] = useState<EditableCandidate[]>([]);
  const preview = previewState?.ok ? previewState.data : undefined;
  const result = resultState?.ok ? resultState.data : undefined;

  useEffect(() => {
    if (preview?.candidates) {
      setCandidates(preview.candidates.map((candidate) => ({ ...candidate, selected: true })));
    }
  }, [preview]);

  const selected = candidates.filter((candidate) => candidate.selected);

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-4 flex items-center gap-2 text-xs text-ink-400">
          <Badge tone={!preview ? 'accent' : 'neutral'}>1 粘贴</Badge>
          <span>→</span>
          <Badge tone={preview && !result ? 'accent' : 'neutral'}>2 编辑确认</Badge>
          <span>→</span>
          <Badge tone={result ? 'accent' : 'neutral'}>3 结果</Badge>
        </div>
        {!aiConfigured ? (
          <div className="mb-4">
            <InfoNote>当前没有配置 AI。提交后仍会保存原文，你可以稍后从知识库手动添加表达。</InfoNote>
          </div>
        ) : null}
        <form action={extractAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div>
              <label htmlFor="paste-title" className="block text-sm font-medium">标题（可选）</label>
              <input
                id="paste-title"
                name="title"
                maxLength={300}
                placeholder="例如：TED 演讲片段"
                className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="paste-language" className="block text-sm font-medium">语言</label>
              <select
                id="paste-language"
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
          <div>
            <label htmlFor="paste-text" className="block text-sm font-medium">文本或字幕</label>
            <textarea
              id="paste-text"
              name="text"
              required
              maxLength={8000}
              rows={10}
              placeholder="粘贴文章、演讲稿或字幕文本…"
              className="mt-1 w-full resize-y rounded-xl border border-ink-200 px-3 py-2.5 text-sm leading-6"
            />
            <p className="mt-1 text-xs text-ink-400">单次最多 8,000 字符；原文会保存在本机。</p>
          </div>
          {previewState && !previewState.ok ? <ErrorNote>{previewState.message}</ErrorNote> : null}
          <button type="submit" className={buttonStyles.primary} disabled={extracting}>
            {extracting ? '正在保存并提炼…' : aiConfigured ? '保存原文并提炼' : '保存原文'}
          </button>
        </form>
      </Card>

      {preview?.notice ? <InfoNote>{preview.notice}</InfoNote> : null}

      {preview?.aiAvailable && candidates.length > 0 ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">人工确认候选表达</h2>
              <p className="mt-1 text-sm text-ink-600">已选 {selected.length} / {candidates.length} 条。可编辑、取消勾选或删除。</p>
            </div>
            <Badge tone="ai">AI 提炼，待你确认</Badge>
          </div>

          <div className="mt-4 space-y-3">
            {candidates.map((candidate, index) => (
              <article key={index} className={`rounded-xl border p-4 ${candidate.selected ? 'border-ink-200' : 'border-ink-100 opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${candidate.content}`}
                    checked={candidate.selected}
                    onChange={(event) => updateCandidate(index, { selected: event.target.checked })}
                    className="mt-3 rounded border-ink-200"
                  />
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_140px]">
                    <label className="text-xs text-ink-400">
                      表达
                      <input
                        value={candidate.content}
                        maxLength={400}
                        onChange={(event) => updateCandidate(index, { content: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900"
                      />
                    </label>
                    <label className="text-xs text-ink-400">
                      类型
                      <select
                        value={candidate.type}
                        onChange={(event) => updateCandidate(index, { type: event.target.value as ExtractedPasteCandidate['type'] })}
                        className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900"
                      >
                        <option value="word">单词</option>
                        <option value="phrase">短语</option>
                        <option value="pattern">句型</option>
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCandidates((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className={buttonStyles.ghost}
                    aria-label={`删除 ${candidate.content}`}
                  >
                    删除
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-ink-400">
                    中文解释
                    <textarea
                      value={candidate.explanation_zh}
                      maxLength={2000}
                      rows={2}
                      onChange={(event) => updateCandidate(index, { explanation_zh: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900"
                    />
                  </label>
                  <label className="text-xs text-ink-400">
                    例句
                    <textarea
                      value={candidate.example ?? ''}
                      maxLength={600}
                      rows={2}
                      onChange={(event) => updateCandidate(index, { example: event.target.value || null })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900"
                    />
                  </label>
                  <label className="text-xs text-ink-400">
                    原文片段
                    <input
                      value={candidate.source_span}
                      maxLength={600}
                      onChange={(event) => updateCandidate(index, { source_span: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900"
                    />
                  </label>
                  <label className="text-xs text-ink-400">
                    场景标签（可选）
                    <input
                      value={candidate.scenario_hint ?? ''}
                      maxLength={80}
                      onChange={(event) => updateCandidate(index, { scenario_hint: event.target.value || null })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900"
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>

          <form action={confirmAction} className="mt-5 space-y-4 border-t border-ink-100 pt-4">
            <input type="hidden" name="sourceId" value={preview.sourceId} />
            <input type="hidden" name="historyId" value={preview.historyId} />
            <input type="hidden" name="languageCode" value={preview.languageCode} />
            <input
              type="hidden"
              name="candidates"
              value={JSON.stringify(selected.map(({ selected: _selected, ...candidate }) => candidate))}
            />
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <input type="checkbox" name="directLearning" className="rounded border-ink-200" />
              直接进入学习（默认先进入词库池）
            </label>
            {resultState && !resultState.ok ? <ErrorNote>{resultState.message}</ErrorNote> : null}
            <button type="submit" className={buttonStyles.primary} disabled={confirming || selected.length === 0}>
              {confirming ? '正在保存…' : `确认导入 ${selected.length} 条`}
            </button>
          </form>
        </Card>
      ) : null}

      {preview && !preview.aiAvailable ? (
        <Card>
          <h2 className="font-semibold">原文已保存</h2>
          <p className="mt-2 text-sm text-ink-600">没有 AI 也不会丢失内容。你可以继续使用手动添加功能。</p>
          <Link href={`/knowledge/sources/${preview.sourceId}`} className={`${buttonStyles.primary} mt-4`}>查看原文并手动摘录</Link>
        </Card>
      ) : null}

      {result ? (
        <Card className="border-accent-100 bg-accent-50">
          <h2 className="font-semibold text-accent-600">确认入库完成</h2>
          <p className="mt-2 text-sm text-ink-600">新增 {result.addedCount} 条，重复 {result.duplicateCount} 条，失败 {result.failedCount} 条。</p>
          <Link href="/knowledge?status=pool" className={`${buttonStyles.primary} mt-4`}>查看词库池</Link>
        </Card>
      ) : null}
    </div>
  );

  function updateCandidate(index: number, patch: Partial<EditableCandidate>) {
    setCandidates((current) => current.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, ...patch } : candidate));
  }
}
