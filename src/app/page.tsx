import Link from 'next/link';
import { Suspense } from 'react';
import { getHomeView } from '@/application/home';
import { startChatAction } from '@/app/actions/chat';
import { resumeSessionAction, startSessionAction } from '@/app/actions/learning';
import { GoalForm } from '@/components/GoalForm';
import { DailyPlan } from '@/components/home/DailyPlan';
import { IntentInput } from '@/components/home/IntentInput';
import { ACTIVITY_LABELS, SKILL_LABELS, TREND_LABELS } from '@/components/labels';
import {
  Badge,
  Card,
  EmptyState,
  InfoNote,
  LinkButton,
  Meter,
  SectionTitle,
  buttonStyles,
} from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

async function HomeContent() {
  const { ctx, learnerId } = app();
  const view = await getHomeView(ctx, learnerId);

  if (!view.hasGoal) {
    return (
      <div className="space-y-6">
        <Card>
          <h1 className="text-xl font-semibold">先说一句你想达到什么</h1>
          <p className="mt-1 text-sm text-ink-600">
            不需要填问卷。系统会从这句话里判断语言和重点技能，之后再根据你的实际表现调整。
          </p>
          <div className="mt-5">
            <GoalForm />
          </div>
        </Card>
        <p className="text-center text-xs text-ink-400">
          数据保存在本机 SQLite。只有在你使用 AI 对话/解释时，少量上下文才会发给你配置的服务商。
        </p>
      </div>
    );
  }

  const timeNote = view.context?.availableMinutes
    ? `按你说的 ${view.context.availableMinutes} 分钟安排`
    : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-ink-400">当前主要目标</p>
          <h1 className="text-xl font-semibold">{view.goal?.title}</h1>
          {view.goal?.scenarios.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {view.goal.scenarios.map((scenario) => (
                <Badge key={scenario}>{scenario}</Badge>
              ))}
            </div>
          ) : null}
        </div>
        <LinkButton href="/goals" variant="ghost">
          管理目标
        </LinkButton>
      </header>

      {!view.placement ? (
        <Card className="border-accent-100 bg-accent-50/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">还没校准你的起点</p>
              <p className="mt-0.5 text-xs text-ink-600">
                测一下（约 10 分钟）或自述水平，好把目标拆成合适的阶段。跳过也没关系。
              </p>
            </div>
            <LinkButton href="/placement" variant="secondary">
              去校准起点
            </LinkButton>
          </div>
        </Card>
      ) : null}

      {view.resumable ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                上次的
                {ACTIVITY_LABELS[view.resumable.activityType]}还没做完
              </p>
              <p className="mt-0.5 text-xs text-ink-600">
                随时接着来，进度都留着。不做完也完全没问题。
              </p>
            </div>
            <form action={resumeSessionAction}>
              <input type="hidden" name="sessionId" value={view.resumable.id} />
              <button
                type="submit"
                className={buttonStyles.secondary}
                data-testid="resume-session"
              >
                继续上次学习
              </button>
            </form>
          </div>
        </Card>
      ) : null}

      {timeNote ? <InfoNote>{timeNote}</InfoNote> : null}

      {view.primary || view.restingToday ? (
        <DailyPlan
          recommendations={view.primary ? [view.primary, ...view.alternatives] : []}
          restingToday={view.restingToday}
          planCounts={view.planCounts}
        />
      ) : (
        <EmptyState
          title="还没有可以安排的练习"
          description="先导入一个词库或添加最近遇到的表达。系统只会推荐真正能交付的活动，不会编内容。"
          action={<LinkButton href="/knowledge/import" variant="primary">导入学习内容</LinkButton>}
        />
      )}

      <section>
        <SectionTitle title="换个方式开始" hint="你随时可以忽略推荐" />
        <div className="grid gap-3 sm:grid-cols-3">
          <form action={startChatAction}>
            <input type="hidden" name="clientToken" value={`chat-${Date.now()}`} />
            <button
              type="submit"
              className="w-full rounded-2xl border border-ink-200 bg-white p-4 text-left hover:bg-ink-50"
              data-testid="start-chat"
            >
              <span className="block text-sm font-medium">自由聊天</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                {view.aiAvailable ? '想聊什么都行，可以关掉纠错' : '未配置 AI，会给出可用替代'}
              </span>
            </button>
          </form>

          <form action={startSessionAction}>
            <input type="hidden" name="activityType" value="quick_review" />
            <input type="hidden" name="minutes" value={view.context?.availableMinutes ?? 5} />
            <input type="hidden" name="clientToken" value={`quick-${Date.now()}`} />
            <button
              type="submit"
              className="w-full rounded-2xl border border-ink-200 bg-white p-4 text-left hover:bg-ink-50 disabled:opacity-50"
              disabled={view.stats.knowledgeCount === 0}
              data-testid="start-quick-review"
            >
              <span className="block text-sm font-medium">快速复习</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                {view.stats.dueCount > 0
                  ? `${view.stats.dueCount} 条到期`
                  : view.stats.knowledgeCount > 0
                    ? '提前过一遍'
                    : '先添加知识条目'}
              </span>
            </button>
          </form>

          <Link
            href="/chat?ask=1"
            className="block rounded-2xl border border-ink-200 bg-white p-4 hover:bg-ink-50"
          >
            <span className="block text-sm font-medium">问个语言问题</span>
            <span className="mt-0.5 block text-xs text-ink-400">先回答你，再问要不要练</span>
          </Link>
        </div>
      </section>

      <Card>
        <IntentInput />
      </Card>

      <section>
        <SectionTitle
          title="最近的情况"
          hint="只展示实际发生过的事，不用连续打卡给你压力"
        />
        <Card>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="7 天内学习次数" value={view.stats.sessionsLast7Days} />
            <Stat label="7 天内作答" value={view.stats.answersLast7Days} />
            <Stat label="待复习" value={view.stats.dueCount} />
            <Stat label="知识条目" value={view.stats.knowledgeCount} />
          </dl>

          {view.skills.length > 0 ? (
            <div className="mt-5 space-y-3 border-t border-ink-100 pt-4">
              {view.skills.map((skill) => (
                <div key={skill.skill}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-ink-900">
                      {SKILL_LABELS[skill.skill]}
                    </span>
                    <span className="text-ink-400">
                      {skill.confidence < 0.25
                        ? '数据还很少，先别当结论'
                        : TREND_LABELS[skill.trend]}
                    </span>
                  </div>
                  <Meter value={skill.mastery} label={`${SKILL_LABELS[skill.skill]}掌握度`} />
                  <p className="mt-1 text-[11px] text-ink-400">
                    置信度 {Math.round(skill.confidence * 100)}%
                    {skill.production !== null
                      ? ` · 产出 ${Math.round(skill.production * 100)}%`
                      : ' · 还没测过主动产出'}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </section>

      {!view.aiAvailable ? (
        <p className="text-xs text-ink-400">
          当前没有配置 AI Provider：对话、解释和文本提炼不可用，但原文保存、复习、知识库、历史和学习状态完全正常。
          配置方式见 <Link href="/settings" className="underline">设置</Link>。
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="正在加载">
      <div className="h-6 w-40 animate-pulse rounded bg-ink-100" />
      <div className="h-32 animate-pulse rounded-2xl bg-ink-100" />
      <div className="h-24 animate-pulse rounded-2xl bg-ink-100" />
    </div>
  );
}
