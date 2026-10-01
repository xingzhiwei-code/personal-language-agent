import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionDetail } from '@/application/history';
import {
  ACTIVITY_LABELS,
  MODALITY_LABELS,
  SESSION_STATUS_LABELS,
} from '@/components/labels';
import { Badge, Card, SectionTitle, formatDateTime } from '@/components/ui';
import { DomainError } from '@/domain/errors';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { ctx, learnerId } = app();

  let detail;
  try {
    detail = await getSessionDetail(ctx, learnerId, sessionId);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'not_found') notFound();
    throw error;
  }

  const { session, assessments, events, chat, knowledge } = detail;
  const byId = new Map(knowledge.map((item) => [item.id, item]));

  return (
    <div className="space-y-5">
      <header>
        <Link href="/history" className="text-xs text-ink-400 hover:text-ink-900">
          ← 学习历史
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          {ACTIVITY_LABELS[session.activityType]}
        </h1>
        <p className="mt-1 text-xs text-ink-400">
          {formatDateTime(session.startedAt ?? session.createdAt)} ·{' '}
          {SESSION_STATUS_LABELS[session.status]}
        </p>
      </header>

      {session.summary ? (
        <Card>
          <SectionTitle title="总结" hint="只记录实际观察到的情况" />
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-ink-400">作答</dt>
              <dd className="mt-0.5 text-lg font-semibold">{session.summary.completedItems}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">答对</dt>
              <dd className="mt-0.5 text-lg font-semibold">{session.summary.correctItems}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">跳过</dt>
              <dd className="mt-0.5 text-lg font-semibold">{session.summary.skippedItems}</dd>
            </div>
          </dl>
        </Card>
      ) : null}

      {assessments.length > 0 ? (
        <Card>
          <SectionTitle title="作答明细" hint="这些是实际测量到的证据" />
          <ul className="space-y-2 text-sm">
            {assessments.map((assessment) => {
              const item = byId.get(assessment.subjectId);
              return (
                <li
                  key={assessment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-200 px-3 py-2"
                >
                  <span>
                    {item ? (
                      <Link href={`/knowledge/${item.id}`} className="underline">
                        {item.text}
                      </Link>
                    ) : (
                      assessment.subjectId
                    )}
                    <Badge>{MODALITY_LABELS[assessment.modality]}</Badge>
                  </span>
                  <span className="text-xs text-ink-400">
                    {assessment.correct ? '答对' : '没答对'} · 得分{' '}
                    {assessment.score.toFixed(2)}
                    {assessment.userCorrected ? ' · 已按你的纠正更新' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {chat.length > 0 ? (
        <Card>
          <SectionTitle title="对话记录" hint="AI 生成的回复会标注出来" />
          <ul className="space-y-2 text-sm">
            {chat.map((message) => (
              <li key={message.id}>
                <span className="text-xs text-ink-400">
                  {message.role === 'user' ? '我' : '助手'}
                  {message.aiGenerated ? '（AI 生成）' : ''}
                </span>
                <p className="mt-0.5">{message.text}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="事件日志" hint="学习者状态由这些事实推导出来" />
        <ul className="space-y-1 text-xs text-ink-600">
          {events.map((event) => (
            <li key={event.id} className="flex justify-between gap-3">
              <span>{event.type}</span>
              <span className="text-ink-400">
                {formatDateTime(event.occurredAt)} · {event.source}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
