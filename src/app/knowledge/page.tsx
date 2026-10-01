import Link from 'next/link';
import { listKnowledge } from '@/application/knowledge';
import { KnowledgeForm } from '@/components/knowledge/KnowledgeForm';
import {
  KNOWLEDGE_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from '@/components/labels';
import {
  Badge,
  Card,
  EmptyState,
  Meter,
  SectionTitle,
  buttonStyles,
  relativeDays,
} from '@/components/ui';
import type { KnowledgeStatus } from '@/domain/enums';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS: { value: string; label: string; statuses?: KnowledgeStatus[] }[] = [
  { value: 'active', label: '学习中', statuses: ['active'] },
  { value: 'mastered', label: '已掌握', statuses: ['user_mastered'] },
  { value: 'irrelevant', label: '不相关', statuses: ['irrelevant'] },
  { value: 'all', label: '全部' },
];

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; new?: string }>;
}) {
  const { q, status, new: isNew } = await searchParams;
  const { ctx, learnerId } = app();
  const filter = STATUS_FILTERS.find((entry) => entry.value === status) ?? STATUS_FILTERS[0]!;

  const { items, total } = await listKnowledge(ctx, {
    learnerId,
    text: q,
    statuses: filter.statuses,
    limit: 100,
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">知识库</h1>
          <p className="mt-1 text-sm text-ink-600">
            共 {total} 条。词和短语是独立条目：figure 和 figure out 不会被合并。
          </p>
        </div>
        <KnowledgeForm defaultOpen={isNew === '1'} />
      </header>

      <Card>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="q" className="block text-xs text-ink-400">
              搜索
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q ?? ''}
              placeholder="搜表达或释义"
              className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm"
              data-testid="knowledge-search"
            />
          </div>
          <div>
            <label htmlFor="status" className="block text-xs text-ink-400">
              状态
            </label>
            <select
              id="status"
              name="status"
              defaultValue={filter.value}
              className="mt-1 rounded-xl border border-ink-200 px-3 py-2 text-sm"
            >
              {STATUS_FILTERS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonStyles.secondary}>
            筛选
          </button>
        </form>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title={q ? '没有匹配的条目' : '知识库还是空的'}
          description={
            q
              ? '换个关键词试试，或者清空搜索条件。'
              : '把你最近真正遇到的表达加进来——它们会进入复习安排，并影响首页推荐。'
          }
        />
      ) : (
        <section>
          <SectionTitle title="条目" hint="点进去可以编辑、建立关系、查看来源" />
          <ul className="space-y-2">
            {items.map(({ item, state }) => (
              <li key={item.id}>
                <Link
                  href={`/knowledge/${item.id}`}
                  className="block rounded-2xl border border-ink-200 bg-white p-4 hover:bg-ink-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{item.text}</span>
                    <Badge>{KNOWLEDGE_TYPE_LABELS[item.type]}</Badge>
                    {item.aiGenerated ? <Badge tone="ai">AI 生成</Badge> : null}
                    {item.status !== 'active' ? (
                      <Badge tone="warn">{STATUS_LABELS[item.status]}</Badge>
                    ) : null}
                  </div>
                  {item.meaning ? (
                    <p className="mt-1 text-sm text-ink-600">{item.meaning}</p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-400">还没有释义</p>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <div className="min-w-[140px] flex-1">
                      <Meter value={state?.mastery ?? 0} label="掌握度" />
                    </div>
                    <span className="text-[11px] text-ink-400">
                      {relativeDays(state?.nextReviewAt ?? null)} ·{' '}
                      {SOURCE_LABELS[item.sourceType]}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
