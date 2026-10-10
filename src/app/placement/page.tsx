import Link from 'next/link';
import { startPlacementAction } from '@/app/actions/learning';
import { getPlacementView } from '@/application/placement';
import { PlacementForm } from '@/components/PlacementForm';
import { Badge, Card, EmptyState, InfoNote } from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '高置信度',
  medium: '中置信度',
  low: '低置信度',
};

export default async function PlacementPage() {
  const { ctx, learnerId } = app();
  const view = await getPlacementView(ctx, learnerId);
  const placement = view.placement;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">起点校准</h1>
          <p className="mt-1 text-sm text-ink-600">
            系统对你水平的判断只是假设，不是结论。你可以随时重测或手动调整。
          </p>
        </div>
        <Link href="/" className="text-xs text-ink-400 hover:text-ink-900">
          返回首页
        </Link>
      </header>

      {placement ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-400">当前起点</span>
            <span className="text-2xl font-semibold tabular-nums">{placement.overallLevel}</span>
            <Badge tone="accent">{CONFIDENCE_LABELS[placement.confidence]}</Badge>
            <Badge>{evidenceLabel(placement.evidence)}</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            摸底只覆盖词汇 / 拼写 / 听辨 / 书面表达四个可测维度，不代表“听说读写”。
          </p>
        </Card>
      ) : (
        <EmptyState
          title="还没有起点记录"
          description="测一下起点（约 10 分钟），或者自述当前水平。这只是为了把目标拆成合适的阶段，不会影响你的学习数据。"
        />
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">摸底测试</h2>
            <p className="mt-1 text-sm text-ink-600">
              覆盖词汇 / 拼写 / 听辨 / 书面表达四个维度，约 10 分钟。
            </p>
          </div>
          <form action={startPlacementAction}>
            <input type="hidden" name="clientToken" value={`placement-${Date.now()}`} />
            <button
              type="submit"
              className="rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-600"
              data-testid="start-placement"
            >
              开始摸底测试
            </button>
          </form>
        </div>
        <div className="mt-3">
          <InfoNote>摸底是测量不是学习：不计连续天数，也不影响你的掌握度。</InfoNote>
        </div>
      </Card>

      <Card>
        <PlacementForm />
      </Card>
    </div>
  );
}

function evidenceLabel(evidence: string[]): string {
  if (evidence.includes('override')) return '手动覆盖';
  if (evidence.includes('test')) return '摸底估算';
  if (evidence.includes('self_report')) return '自述';
  return '未知来源';
}
