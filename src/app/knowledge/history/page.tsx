import { listImportExportHistory } from '@/application/audit';
import { KnowledgeTabs } from '@/components/knowledge/KnowledgeTabs';
import { Badge, Card, EmptyState, LinkButton, formatDateTime } from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

const STATUS = {
  success: { label: '成功', tone: 'accent' as const },
  partial: { label: '部分成功', tone: 'warn' as const },
  failed: { label: '失败', tone: 'warn' as const },
};

export default async function ImportExportHistoryPage() {
  const { ctx, learnerId } = app();
  const records = await listImportExportHistory(ctx, learnerId);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">知识库历史</h1>
          <p className="mt-1 text-sm text-ink-600">每次导入和导出的结果都会保存在本机。</p>
        </div>
        <LinkButton href="/knowledge/import" variant="primary">导入词库</LinkButton>
      </header>
      <KnowledgeTabs active="history" />

      {records.length === 0 ? (
        <EmptyState
          title="还没有导入导出记录"
          description="完成一次词库导入后，新增、重复和失败数量会显示在这里。"
          action={<LinkButton href="/knowledge/import">开始导入</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {records.map((record) => (
            <Card key={record.id} as="li">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{record.sourceLabel}</span>
                    <Badge>{record.type === 'import' ? '导入' : '导出'}</Badge>
                    <Badge tone={STATUS[record.status].tone}>{STATUS[record.status].label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-400">
                    {record.format.toUpperCase()} · {formatDateTime(record.createdAt)}
                  </p>
                </div>
                <p className="text-sm tabular-nums text-ink-600">
                  总计 {record.totalCount} · 新增 {record.addedCount} · 重复 {record.duplicateCount} · 失败 {record.failedCount}
                </p>
              </div>
              {record.errors.length > 0 ? (
                <details className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <summary>失败明细</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {record.errors.map((error) => (
                      <li key={`${error.row}-${error.reason}`}>第 {error.row} 行：{error.reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
