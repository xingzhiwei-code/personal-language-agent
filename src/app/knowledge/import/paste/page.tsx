import Link from 'next/link';
import { PasteImportWizard } from '@/components/knowledge/PasteImportWizard';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default function PasteImportPage() {
  const { ctx } = app();
  return (
    <div className="space-y-5">
      <header>
        <Link href="/knowledge" className="text-sm text-ink-600 hover:text-ink-900">← 返回知识库</Link>
        <h1 className="mt-2 text-lg font-semibold">从文本提炼表达</h1>
        <p className="mt-1 text-sm text-ink-600">粘贴文本或字幕，AI 只负责提出候选；只有你确认的表达才会进入知识库。</p>
        <nav className="mt-3 flex gap-2 text-sm">
          <Link href="/knowledge/import" className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-ink-600">文件导入</Link>
          <span className="rounded-lg bg-accent-500 px-3 py-2 font-medium text-white">文本提炼</span>
        </nav>
      </header>
      <PasteImportWizard aiConfigured={ctx.llm.isConfigured()} />
    </div>
  );
}
