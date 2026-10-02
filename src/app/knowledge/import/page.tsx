import Link from 'next/link';
import { ImportWizard } from '@/components/knowledge/ImportWizard';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function KnowledgeImportPage() {
  const { ctx, learnerId } = app();
  const goals = await ctx.repos.goals.listByLearner(learnerId, ['active']);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/knowledge" className="text-sm text-ink-600 hover:text-ink-900">
          ← 返回知识库
        </Link>
        <h1 className="mt-2 text-lg font-semibold">导入词库</h1>
        <p className="mt-1 text-sm text-ink-600">
          支持 CSV、JSON 和每行一词的 TXT。预览确认后，条目会安全地进入词库池。
        </p>
        <nav className="mt-3 flex gap-2 text-sm">
          <span className="rounded-lg bg-accent-500 px-3 py-2 font-medium text-white">文件导入</span>
          <Link href="/knowledge/import/paste" className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-ink-600">文本提炼</Link>
        </nav>
      </header>
      <ImportWizard
        goals={goals.map((goal) => ({ id: goal.id, title: goal.title, isPrimary: goal.isPrimary }))}
      />
    </div>
  );
}
