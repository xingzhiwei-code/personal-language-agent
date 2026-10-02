import Link from 'next/link';
import { KnowledgeTabs } from '@/components/knowledge/KnowledgeTabs';
import { Card, EmptyState, formatDateTime } from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function ContentSourcesPage() {
  const { ctx, learnerId } = app();
  const sources = await ctx.repos.content.listSourcesByLearner(learnerId, 1000);
  const pasted = sources.filter((source) => source.extractionMethod === 'paste');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">已保存原文</h1>
        <p className="mt-1 text-sm text-ink-600">无论 AI 是否可用，你主动粘贴的文本都保存在本机，可随时回来摘录表达。</p>
      </header>
      <KnowledgeTabs active="sources" />
      {pasted.length === 0 ? (
        <EmptyState title="还没有保存原文" description="从文本提炼页面粘贴文本后会显示在这里。" />
      ) : (
        <ul className="space-y-2">
          {pasted.map((source) => (
            <Card key={source.id} as="li">
              <Link href={`/knowledge/sources/${source.id}`} className="block hover:text-accent-600">
                <p className="font-medium">{source.title ?? '未命名文本'}</p>
                <p className="mt-1 text-xs text-ink-400">{formatDateTime(source.createdAt)} · 本机保存</p>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
