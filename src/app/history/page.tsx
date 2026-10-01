import Link from 'next/link';
import { getLearningHistory } from '@/application/history';
import { ACTIVITY_LABELS, SESSION_STATUS_LABELS } from '@/components/labels';
import { Badge, EmptyState, LinkButton, formatDateTime } from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { ctx, learnerId } = app();
  const entries = await getLearningHistory(ctx, learnerId, 50);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">学习历史</h1>
        <p className="mt-1 text-sm text-ink-600">
          按时间记录真实发生的学习。没做完的会话不是失败，只是当时结束了。
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          title="还没有学习记录"
          description="从首页开始一次练习或对话，这里就会出现记录。"
          action={<LinkButton href="/" variant="primary">回首页</LinkButton>}
        />
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.session.id}>
              <Link
                href={`/history/${entry.session.id}`}
                className="block rounded-2xl border border-ink-200 bg-white p-4 hover:bg-ink-50"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {ACTIVITY_LABELS[entry.session.activityType]}
                  </span>
                  <Badge
                    tone={
                      entry.session.status === 'completed'
                        ? 'accent'
                        : entry.session.status === 'abandoned'
                          ? 'neutral'
                          : 'warn'
                    }
                  >
                    {SESSION_STATUS_LABELS[entry.session.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  {formatDateTime(entry.session.startedAt ?? entry.session.createdAt)}
                  {entry.durationMinutes !== null ? ` · ${entry.durationMinutes} 分钟` : ''}
                  {entry.assessmentCount > 0
                    ? ` · 作答 ${entry.assessmentCount}，答对 ${entry.correctCount}`
                    : ' · 没有作答记录'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
