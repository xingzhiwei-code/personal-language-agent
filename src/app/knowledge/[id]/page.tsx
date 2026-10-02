import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteKnowledgeAction, removeRelationAction } from '@/app/actions/knowledge';
import { getKnowledgeDetail, listKnowledge } from '@/application/knowledge';
import { KnowledgeEditor } from '@/components/knowledge/KnowledgeEditor';
import { KnowledgeFlowControls } from '@/components/knowledge/KnowledgeFlowControls';
import { RelationForm } from '@/components/knowledge/RelationForm';
import {
  KNOWLEDGE_TYPE_LABELS,
  MODALITY_LABELS,
  ORIGIN_LABELS,
  RELATION_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TREND_LABELS,
} from '@/components/labels';
import {
  Badge,
  Card,
  Meter,
  SectionTitle,
  buttonStyles,
  formatDateTime,
  relativeDays,
} from '@/components/ui';
import { DomainError } from '@/domain/errors';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, learnerId } = app();

  let detail;
  try {
    detail = await getKnowledgeDetail(ctx, learnerId, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'not_found') notFound();
    throw error;
  }

  const { item, state, relations } = detail;
  const { items: candidates } = await listKnowledge(ctx, {
    learnerId,
    statuses: ['active'],
    limit: 50,
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/knowledge" className="text-xs text-ink-400 hover:text-ink-900">
            ← 知识库
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{item.text}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge>{KNOWLEDGE_TYPE_LABELS[item.type]}</Badge>
            <Badge tone={item.aiGenerated ? 'ai' : 'neutral'}>
              {ORIGIN_LABELS[item.origin]}
            </Badge>
            <Badge>{SOURCE_LABELS[item.sourceType]}</Badge>
            {item.status !== 'active' ? (
              <Badge tone="warn">{STATUS_LABELS[item.status]}</Badge>
            ) : null}
          </div>
        </div>
      </header>

      <Card>
        <SectionTitle title="学习状态" hint="掌握度与置信度是两个独立的量" />
        {state && state.exposureCount > 0 ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs text-ink-400">掌握度估计</p>
              <Meter value={state.mastery} label="掌握度" />
            </div>
            <div>
              <p className="mb-1 text-xs text-ink-400">系统对这个估计的置信度</p>
              <Meter value={state.confidence} label="置信度" />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Detail label="练习次数" value={String(state.exposureCount)} />
              <Detail
                label="正确 / 错误"
                value={`${state.successfulAttempts} / ${state.failedAttempts}`}
              />
              <Detail label="趋势" value={TREND_LABELS[state.trend]} />
              <Detail label="下次复习" value={relativeDays(state.nextReviewAt)} />
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3 text-xs">
              {(['recognition', 'recall', 'production', 'listening'] as const).map((modality) => {
                const stat = state.modalityStats[modality];
                return (
                  <span
                    key={modality}
                    className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-600"
                  >
                    {MODALITY_LABELS[modality]}：
                    {stat ? `${Math.round(stat.strength * 100)}%（${stat.attempts} 次）` : '未测'}
                  </span>
                );
              })}
            </div>
            {state.userDeclaredMastered ? (
              <p className="text-xs text-ink-400">你说过这条已经会了，系统已经把它排到更后面。</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-ink-400">
            还没有练习记录。系统不会凭空猜你的掌握程度——练一次就有数据了。
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle title="内容" />
        <KnowledgeFlowControls id={item.id} status={item.status} />
        <KnowledgeEditor item={item} />
      </Card>

      {item.examples.length > 0 ? (
        <Card>
          <SectionTitle title="例句" hint="标注了来源，AI 生成的例句会明确标记" />
          <ul className="space-y-2 text-sm">
            {item.examples.map((example) => (
              <li key={example.text} className="rounded-xl bg-ink-50 px-3 py-2">
                <p>{example.text}</p>
                <p className="mt-1 text-[11px] text-ink-400">
                  {ORIGIN_LABELS[example.origin]}
                  {example.sourceRef ? ` · ${example.sourceRef}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="关系" hint="知识是图，不是列表" />
        {relations.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {relations.map(({ relation, other, direction }) => (
              <li
                key={relation.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-200 px-3 py-2"
              >
                <span className="text-sm">
                  <Badge>{RELATION_LABELS[relation.type]}</Badge>
                  <span className="ml-2 text-ink-400">{direction === 'out' ? '→' : '←'}</span>
                  <Link href={`/knowledge/${other.id}`} className="ml-2 underline">
                    {other.text}
                  </Link>
                </span>
                <form action={removeRelationAction}>
                  <input type="hidden" name="relationId" value={relation.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <button type="submit" className="text-xs text-ink-400 hover:text-red-600">
                    移除
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-ink-400">还没有建立关系。</p>
        )}
        <RelationForm
          fromItemId={item.id}
          candidates={candidates
            .filter((entry) => entry.item.id !== item.id)
            .map((entry) => ({ id: entry.item.id, text: entry.item.text }))}
        />
      </Card>

      <Card>
        <SectionTitle title="来源与时间" />
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <Detail label="创建时间" value={formatDateTime(item.createdAt)} />
          <Detail label="最近更新" value={formatDateTime(item.updatedAt)} />
          <Detail label="来源类型" value={SOURCE_LABELS[item.sourceType]} />
          <Detail label="来源标识" value={item.sourceRef ?? '—'} />
        </dl>
      </Card>

      <form action={deleteKnowledgeAction}>
        <input type="hidden" name="id" value={item.id} />
        <button type="submit" className={buttonStyles.ghost}>
          删除这条
        </button>
      </form>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{value}</dd>
    </div>
  );
}
