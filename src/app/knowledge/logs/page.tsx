import Link from 'next/link';
import { listKnowledgeOperationLogs } from '@/application/audit';
import { KnowledgeTabs } from '@/components/knowledge/KnowledgeTabs';
import { Badge, Card, EmptyState, formatDateTime } from '@/components/ui';
import type { KnowledgeOperationType } from '@/domain/enums';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

const OPERATIONS: { value: KnowledgeOperationType; label: string }[] = [
  { value: 'create', label: '新增' },
  { value: 'update', label: '修改' },
  { value: 'delete', label: '删除' },
  { value: 'import', label: '导入' },
  { value: 'export', label: '导出' },
  { value: 'promote_to_learning', label: '加入学习' },
  { value: 'pause_to_pool', label: '暂停回池' },
  { value: 'goal_binding_changed', label: '目标绑定' },
];

const OPERATION_LABELS = Object.fromEntries(
  OPERATIONS.map((operation) => [operation.value, operation.label]),
) as Record<KnowledgeOperationType, string>;

export default async function KnowledgeLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const selected = OPERATIONS.find((operation) => operation.value === type)?.value;
  const { ctx, learnerId } = app();
  const logs = await listKnowledgeOperationLogs(ctx, {
    learnerId,
    operations: selected ? [selected] : undefined,
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">知识库操作日志</h1>
        <p className="mt-1 text-sm text-ink-600">数据管理记录与学习事件分开保存，不参与掌握度计算。</p>
      </header>
      <KnowledgeTabs active="logs" />

      <nav aria-label="日志类型筛选" className="flex flex-wrap gap-2">
        <FilterLink href="/knowledge/logs" active={!selected}>全部</FilterLink>
        {OPERATIONS.map((operation) => (
          <FilterLink
            key={operation.value}
            href={`/knowledge/logs?type=${operation.value}`}
            active={selected === operation.value}
          >
            {operation.label}
          </FilterLink>
        ))}
      </nav>

      {logs.length === 0 ? (
        <EmptyState title="没有匹配的操作记录" description="新增、修改、删除或导入知识后，记录会显示在这里。" />
      ) : (
        <ul className="space-y-3">
          {logs.map((log) => (
            <Card key={log.id} as="li">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={log.operation === 'delete' ? 'warn' : 'neutral'}>
                      {OPERATION_LABELS[log.operation]}
                    </Badge>
                    <span className="truncate font-medium">{log.itemText ?? '知识库'}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-400">
                    {formatDateTime(log.createdAt)} · {sourceLabel(log.source)}
                  </p>
                </div>
                {log.knowledgeItemId && log.operation !== 'delete' ? (
                  <Link href={`/knowledge/${log.knowledgeItemId}`} className="text-sm text-accent-600 hover:underline">
                    查看条目
                  </Link>
                ) : null}
              </div>
              {Object.keys(log.changes).length > 0 ? (
                <dl className="mt-3 grid gap-2 rounded-xl bg-ink-50 p-3 text-xs">
                  {Object.entries(log.changes).map(([field, value]) => {
                    const pair = Array.isArray(value) ? value : [null, value];
                    return (
                      <div key={field} className="grid gap-1 sm:grid-cols-[110px_1fr]">
                        <dt className="font-medium text-ink-600">{field}</dt>
                        <dd className="break-words text-ink-400">
                          {displayValue(pair[0])} → {displayValue(pair[1])}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
              {log.note ? <p className="mt-2 text-xs text-ink-600">{log.note}</p> : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-xs font-medium ${
        active ? 'bg-accent-500 text-white' : 'border border-ink-200 bg-white text-ink-600'
      }`}
    >
      {children}
    </Link>
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '空';
  if (typeof value === 'string') return value || '空';
  const serialized = JSON.stringify(value);
  return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
}

function sourceLabel(source: string): string {
  if (source === 'file_upload') return '文件导入';
  if (source === 'paste') return '文本导入';
  if (source === 'export_restore') return '导出恢复';
  return '手动操作';
}
