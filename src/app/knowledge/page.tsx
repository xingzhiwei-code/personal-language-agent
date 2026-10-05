import Link from 'next/link';
import { listKnowledge } from '@/application/knowledge';
import { listScenarios } from '@/application/scenarios';
import { KnowledgeForm } from '@/components/knowledge/KnowledgeForm';
import { KnowledgeTabs } from '@/components/knowledge/KnowledgeTabs';
import { PoolBrowser } from '@/components/knowledge/PoolBrowser';
import {
  KNOWLEDGE_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from '@/components/labels';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
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
  { value: 'pool', label: '词库池', statuses: ['new'] },
  { value: 'mastered', label: '已掌握', statuses: ['user_mastered'] },
  { value: 'irrelevant', label: '不相关', statuses: ['irrelevant'] },
  { value: 'all', label: '全部' },
];

const PAGE_SIZE = 50;

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    new?: string;
    wordlist?: string;
    tag?: string;
    page?: string;
  }>;
}) {
  const { q, status, new: isNew, wordlist, tag, page: pageRaw } = await searchParams;
  const { ctx, learnerId } = app();
  const filter = STATUS_FILTERS.find((entry) => entry.value === status) ?? STATUS_FILTERS[0]!;
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
  const wordlists = await ctx.repos.wordlists.listByLearner(learnerId);
  const scenarios = (await listScenarios(ctx, learnerId)).filter(
    (scenario) => scenario.status === 'active',
  );
  const selectedWordlist = wordlists.some((entry) => entry.id === wordlist) ? wordlist : undefined;
  const tags = tag?.trim() ? [tag.trim().toLowerCase()] : undefined;
  const { items, total } = await listKnowledge(ctx, {
    learnerId,
    text: q,
    statuses: filter.statuses,
    tags,
    wordlistIds: selectedWordlist ? [selectedWordlist] : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportQuery = new URLSearchParams({ status: filter.value });
  if (q) exportQuery.set('q', q);
  if (selectedWordlist) exportQuery.set('wordlist', selectedWordlist);
  if (tag) exportQuery.set('tag', tag);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">知识库</h1>
          <p className="mt-1 text-sm text-ink-600">
            共 {total} 条。词和短语是独立条目：figure 和 figure out 不会被合并。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/api/knowledge/export?format=json&${exportQuery}`}>
            导出 JSON
          </LinkButton>
          <LinkButton href={`/api/knowledge/export?format=csv&${exportQuery}`}>
            导出 CSV
          </LinkButton>
          <LinkButton href="/knowledge/import" variant="primary">
            导入词库
          </LinkButton>
          <KnowledgeForm defaultOpen={isNew === '1'} />
        </div>
      </header>

      <KnowledgeTabs active={filter.value === 'pool' ? 'pool' : 'library'} />

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
          <div>
            <label htmlFor="wordlist" className="block text-xs text-ink-400">词库</label>
            <select id="wordlist" name="wordlist" defaultValue={selectedWordlist ?? ''} className="mt-1 max-w-48 rounded-xl border border-ink-200 px-3 py-2 text-sm">
              <option value="">全部词库</option>
              {wordlists.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tag" className="block text-xs text-ink-400">标签</label>
            <input id="tag" name="tag" defaultValue={tag ?? ''} placeholder="精确标签" className="mt-1 w-28 rounded-xl border border-ink-200 px-3 py-2 text-sm" />
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
              : '导入已有词库或粘贴真实文本，先建立素材池；也可以手动添加最近遇到的表达。'
          }
          action={q ? undefined : <LinkButton href="/knowledge/import" variant="primary">导入第一批内容</LinkButton>}
        />
      ) : (
        <section>
          <SectionTitle
            title={filter.value === 'pool' ? '词库池' : '条目'}
            hint={filter.value === 'pool' ? '选择本页条目加入学习；每天也会按预算自动选择' : '点进去可以编辑、建立关系、查看来源'}
          />
          {filter.value === 'pool' ? (
            <PoolBrowser
              entries={items}
              wordlistNames={Object.fromEntries(wordlists.map((entry) => [entry.id, entry.name]))}
              scenarios={scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name }))}
            />
          ) : (
            <ul className="space-y-2">
              {items.map(({ item, state }) => (
                <li key={item.id}>
                  <Link href={`/knowledge/${item.id}`} className="block rounded-2xl border border-ink-200 bg-white p-4 hover:bg-ink-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.text}</span>
                      <Badge>{KNOWLEDGE_TYPE_LABELS[item.type]}</Badge>
                      {item.aiGenerated ? <Badge tone="ai">AI 生成</Badge> : null}
                      {item.status !== 'active' ? <Badge tone="warn">{STATUS_LABELS[item.status]}</Badge> : null}
                    </div>
                    {item.meaning ? <p className="mt-1 text-sm text-ink-600">{item.meaning}</p> : <p className="mt-1 text-xs text-ink-400">还没有释义</p>}
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <div className="min-w-[140px] flex-1"><Meter value={state?.mastery ?? 0} label="掌握度" /></div>
                      <span className="text-[11px] text-ink-400">{relativeDays(state?.nextReviewAt ?? null)} · {SOURCE_LABELS[item.sourceType]}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pagination current={page} total={pageCount} query={exportQuery} />
        </section>
      )}
    </div>
  );
}

function Pagination({
  current,
  total,
  query,
}: {
  current: number;
  total: number;
  query: URLSearchParams;
}) {
  if (total <= 1) return null;
  const hrefFor = (page: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    return `/knowledge?${params}`;
  };
  return (
    <nav aria-label="知识库分页" className="mt-4 flex items-center justify-center gap-3 text-sm">
      {current > 1 ? <Link href={hrefFor(current - 1)} className={buttonStyles.secondary}>上一页</Link> : null}
      <span className="text-ink-400">第 {current} / {total} 页</span>
      {current < total ? <Link href={hrefFor(current + 1)} className={buttonStyles.secondary}>下一页</Link> : null}
    </nav>
  );
}
