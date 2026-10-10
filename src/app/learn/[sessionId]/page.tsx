import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  abandonSessionAction,
  completeSessionAction,
  pauseSessionAction,
  skipActivityAction,
  startSessionAction,
} from '@/app/actions/learning';
import {
  completeSession,
  getSessionMasteryChanges,
  getSessionView,
} from '@/application/sessions';
import { getPlacementView } from '@/application/placement';
import { getCurrentStreak } from '@/application/streak';
import { getLemmaRelations, lemmaOf } from '@/application/topic';
import { ActivityRunner } from '@/components/learn/ActivityRunner';
import { WarmupRunner } from '@/components/learn/WarmupRunner';
import { ACTIVITY_LABELS, SKILL_LABELS } from '@/components/labels';
import { Card, EmptyState, LinkButton, buttonStyles } from '@/components/ui';
import { DomainError } from '@/domain/errors';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const { sessionId } = await params;
  const { a: requestedActivityId } = await searchParams;
  const { ctx, learnerId } = app();
  const aiAvailable = ctx.llm.isConfigured();

  let view;
  try {
    view = await getSessionView(ctx, learnerId, sessionId);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'not_found') notFound();
    throw error;
  }

  const { session, activities, nextActivity, progress, knowledgeById } = view;
  const finished = session.status === 'completed' || session.status === 'abandoned';

  if (activities.length === 0) {
    return (
      <div className="space-y-4">
        <Header title={ACTIVITY_LABELS[session.activityType]} />
        <EmptyState
          title="这次没有可用的练习内容"
          description="你的知识库里还没有足够的条目来生成这个练习。先添加几条，或者直接开始一次对话。"
          action={<LinkButton href="/knowledge?new=1" variant="primary">添加知识条目</LinkButton>}
        />
        <form action={abandonSessionAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit" className={buttonStyles.ghost}>
            退出
          </button>
        </form>
      </div>
    );
  }

  const pinned = requestedActivityId
    ? activities.find((activity) => activity.id === requestedActivityId)
    : undefined;

  // A pinned activity keeps rendering even after it was answered, so the
  // learner sees the result before moving on.
  if (finished || (!nextActivity && !pinned)) {
    if (!finished) {
      // Everything is done: close the session (idempotent) and show the summary.
      await completeSession(ctx, { learnerId, sessionId: session.id });
      view = await getSessionView(ctx, learnerId, sessionId);
    }
    const summary = view.session.summary;
    const completed = view.session.status === 'completed';
    const completedItems = summary?.completedItems ?? progress.answered;
    const correctItems = summary?.correctItems ?? 0;
    const accuracy =
      completedItems > 0 ? Math.round((correctItems / completedItems) * 100) : null;
    const masteryChanges = completed
      ? await getSessionMasteryChanges(ctx, learnerId, session.id)
      : [];
    const streak = completed ? await getCurrentStreak(ctx, learnerId) : null;
    const isPlacement = session.activityType === 'placement';
    const placementView = isPlacement ? await getPlacementView(ctx, learnerId) : null;

    return (
      <div className="space-y-5">
        <Header title={`${ACTIVITY_LABELS[session.activityType]}·总结`} />
        <Card>
          <p className="text-sm text-ink-600">
            {view.session.status === 'abandoned'
              ? '这次提前结束了——完全没问题，记录都保存好了。'
              : isPlacement
                ? '这次水平摸底完成了。下面是实测的四科粗估，不是打分，也不影响你的学习数据。'
                : '这次完成了。下面是实际发生的事，不是打分。'}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-ink-400">作答</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{completedItems}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">答对</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{correctItems}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">正确率</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                {accuracy === null ? '—' : `${accuracy}%`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">用时</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                {sessionDuration(view.session.startedAt, view.session.endedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">跳过</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                {summary?.skippedItems ?? progress.skipped}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">连续学习</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                {isPlacement ? '—' : completed && streak !== null ? `${streak} 天` : '—'}
              </dd>
            </div>
          </dl>

          {isPlacement && placementView?.placement ? (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="text-xs text-ink-400">实测四科粗估（内部 0–9 分，对齐雅思分数）：</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <PlacementStat label="词汇" value={placementView.placement.skills.vocabulary} />
                <PlacementStat label="拼写" value={placementView.placement.skills.spelling} />
                <PlacementStat label="听辨" value={placementView.placement.skills.listening} />
                <PlacementStat label="书面表达" value={placementView.placement.skills.writtenExpression} />
              </dl>
              <p className="mt-3 text-sm text-ink-600">
                综合起点约{' '}
                <span className="font-semibold tabular-nums">
                  {placementView.placement.overallLevel}
                </span>{' '}
                分 · 摸底估算 · 置信度中
              </p>
              <p className="mt-1 text-xs text-ink-400">
                水平摸底不计连续天数、不影响掌握度。可在“目标 → 重新校准起点”重测或调整。
              </p>
            </div>
          ) : null}

          {masteryChanges.length > 0 ? (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="text-xs text-ink-400">这次掌握的技能变化：</p>
              <ul className="mt-1.5 space-y-1">
                {masteryChanges.map((change) => (
                  <li key={change.skill} className="text-sm text-ink-600">
                    {SKILL_LABELS[change.skill] ?? change.skill}{' '}
                    {Math.round(change.before * 100)}%→{Math.round(change.after * 100)}%
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary?.difficulties.length ? (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="text-xs text-ink-400">这几条这次没答对，之后会再出现：</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {summary.difficulties.map((text) => (
                  <li
                    key={text}
                    className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary?.knowledgeItemIds.length ? (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="text-xs text-ink-400">涉及的知识条目</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {summary.knowledgeItemIds.slice(0, 12).map((id) => {
                  const item = knowledgeById[id];
                  return item ? (
                    <li key={id}>
                      <Link
                        href={`/knowledge/${id}`}
                        className="rounded-full border border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-50"
                      >
                        {item.text}
                      </Link>
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          ) : null}
        </Card>

        <div className="flex flex-wrap gap-2">
          <LinkButton href="/" variant="primary">
            回首页
          </LinkButton>
          <LinkButton href={`/history/${session.id}`}>查看这次记录</LinkButton>
          {completed ? (
            <form action={startSessionAction}>
              <input type="hidden" name="activityType" value="quick_review" />
              <input type="hidden" name="minutes" value="5" />
              <input type="hidden" name="clientToken" value={`another-round-${session.id}`} />
              <button type="submit" className={buttonStyles.secondary}>
                再来一组复习
              </button>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  // Warmup phase (v0.3 §D1): expose new words first, before any testing.
  const pendingWarmup = view.warmup.nextPending;
  if (pendingWarmup) {
    const warmupPosition =
      view.warmup.activities.filter(
        (activity) => activity.status !== 'pending' && activity.position < pendingWarmup.position,
      ).length + 1;
    return (
      <div className="space-y-5">
        <Header title={ACTIVITY_LABELS[session.activityType]} />
        <WarmupRunner
          activity={pendingWarmup}
          item={knowledgeById[pendingWarmup.subjectId]}
          sessionId={session.id}
          position={warmupPosition}
          total={view.warmup.activities.length}
        />
      </div>
    );
  }

  /**
   * The current activity is pinned in the URL (`?a=`). A server action re-render
   * therefore keeps showing the same question, so the learner actually sees the
   * feedback for their answer instead of being jumped to the next item.
   */
  if (!pinned && nextActivity) {
    redirect(`/learn/${session.id}?a=${nextActivity.id}`);
  }
  if (!pinned) {
    redirect(`/learn/${session.id}`);
  }

  const current = pinned;
  const currentItem = knowledgeById[current.subjectId];
  const currentRelations = currentItem
    ? (await getLemmaRelations(ctx, [lemmaOf(currentItem.text)]).then((map) =>
        map.get(lemmaOf(currentItem.text)) ?? [],
      ))
    : [];
  const answeredPosition =
    activities.filter(
      (activity) =>
        activity.kind !== 'warmup_exposure' &&
        activity.status !== 'pending' &&
        activity.position < current.position,
    ).length + 1;

  return (
    <div className="space-y-5">
      <Header title={ACTIVITY_LABELS[session.activityType]} />

      <ActivityRunner
        key={current.id}
        activity={current}
        item={currentItem}
        alreadyAnswered={current.status !== 'pending'}
        aiAvailable={aiAvailable}
        sessionId={session.id}
        position={answeredPosition}
        total={progress.total}
        relations={currentRelations}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
        <form action={skipActivityAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <input type="hidden" name="activityId" value={current.id} />
          <button type="submit" className={buttonStyles.ghost} data-testid="skip-activity">
            跳过这个
          </button>
        </form>
        <form action={pauseSessionAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit" className={buttonStyles.ghost} data-testid="pause-session">
            先暂停
          </button>
        </form>
        <form action={completeSessionAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit" className={buttonStyles.ghost}>
            就到这里
          </button>
        </form>
        <form action={abandonSessionAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit" className={buttonStyles.ghost}>
            退出
          </button>
        </form>
      </div>
      <p className="text-xs text-ink-400">
        随时可以走，不需要理由。没做完不算失败，进度会留着。
      </p>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Link href="/" className="text-xs text-ink-400 hover:text-ink-900">
        返回首页
      </Link>
    </header>
  );
}

/** Human duration between session start and end, honest and never fabricated. */
function sessionDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return '—';
  const minutes = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000);
  if (minutes < 1) return '不到 1 分钟';
  return `${minutes} 分钟`;
}

/** One measured placement dimension; null means "not measured", never "0". */
function PlacementStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}
