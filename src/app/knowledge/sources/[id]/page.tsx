import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SourceManualAdd } from '@/components/knowledge/SourceManualAdd';
import { Card, SectionTitle } from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function ContentSourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, learnerId } = app();
  const source = await ctx.repos.content.findSourceById(id);
  if (!source || source.learnerId !== learnerId || source.extractionMethod !== 'paste') notFound();
  const contents = await ctx.repos.content.listContentBySource(id);
  const content = contents[0];
  if (!content) notFound();
  return (
    <div className="space-y-5">
      <header>
        <Link href="/knowledge/sources" className="text-sm text-ink-600">← 已保存原文</Link>
        <h1 className="mt-2 text-lg font-semibold">{source.title ?? '未命名文本'}</h1>
      </header>
      <Card>
        <SectionTitle title="原文" hint="保存在本机；可从中手动摘录表达" />
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-50 p-4 text-sm leading-6 text-ink-600">{content.text}</pre>
      </Card>
      <Card>
        <SectionTitle title="手动添加表达" hint="保存后会关联到这篇原文" />
        <SourceManualAdd sourceId={source.id} languageCode={content.languageCode} />
      </Card>
    </div>
  );
}
