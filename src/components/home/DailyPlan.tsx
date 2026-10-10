'use client';

import { useId, useState } from 'react';
import {
  replaceDailyPlanAction,
  restDailyPlanAction,
  resumeDailyPlanAction,
  startSessionAction,
} from '@/app/actions/learning';
import { ACTIVITY_LABELS } from '@/components/labels';
import { Badge, buttonStyles, Card } from '@/components/ui';
import type { Recommendation } from '@/domain/entities';

export function DailyPlan({
  recommendations,
  restingToday,
  planCounts,
  startupReason,
}: {
  recommendations: Recommendation[];
  restingToday: boolean;
  planCounts: { newCount: number; reviewCount: number } | null;
  /** Upgraded one-line startup explanation (v0.4 §G4). */
  startupReason?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const token = useId();

  if (restingToday) {
    return (
      <Card className="border-accent-100 bg-accent-50/60">
        <h2 className="text-lg font-semibold">今天已设为休息日</h2>
        <p className="mt-1 text-sm text-ink-600">今天不会再生成计划或提醒。跨日后会自动恢复。</p>
        <form action={resumeDailyPlanAction} className="mt-4">
          <button type="submit" className={buttonStyles.secondary}>恢复今日计划</button>
        </form>
      </Card>
    );
  }

  if (recommendations.length === 0) return null;
  const first = recommendations[0]!;
  const totalMinutes = recommendations.reduce(
    (sum, recommendation) => sum + recommendation.plannedDurationMinutes,
    0,
  );

  return (
    <Card className="border-accent-100 bg-gradient-to-b from-accent-50/70 to-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-accent-600">今日计划</p>
          <h2 className="mt-0.5 text-lg font-semibold">
            新学 {planCounts?.newCount ?? 0} · 复习 {planCounts?.reviewCount ?? 0} · 预计 {totalMinutes} 分钟
          </h2>
          <p className="mt-1 text-sm text-ink-600">{startupReason ?? first.reason}</p>
        </div>
        <Badge tone="accent">本地规则生成</Badge>
      </div>

      <ol className="mt-4 space-y-2">
        {recommendations.map((recommendation, index) => (
          <li key={recommendation.id} className="rounded-xl border border-ink-100 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-xs font-medium">{index + 1}</span>
              <span className="font-medium">{ACTIVITY_LABELS[recommendation.activityType]}</span>
              <Badge>约 {recommendation.plannedDurationMinutes} 分钟</Badge>
              {recommendation.estimatedItemCount > 0 ? <Badge>{recommendation.estimatedItemCount} 个任务</Badge> : null}
              {recommendation.requiresAi ? <Badge tone="ai">需要 AI</Badge> : null}
            </div>
            <p className="mt-1.5 pl-8 text-xs text-ink-600">{recommendation.reason}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <form action={startSessionAction} onSubmit={() => setPending(true)}>
          <input type="hidden" name="activityType" value={first.activityType} />
          <input type="hidden" name="minutes" value={first.plannedDurationMinutes} />
          <input type="hidden" name="recommendationId" value={first.id} />
          <input type="hidden" name="clientToken" value={`daily-${first.id}-${token}`} />
          <button type="submit" className={buttonStyles.primary} disabled={pending} data-testid="start-recommendation">
            {pending ? '正在准备…' : '一键开始今日计划'}
          </button>
        </form>
        <form action={replaceDailyPlanAction}>
          {recommendations.map((recommendation) => (
            <input key={recommendation.id} type="hidden" name="recommendationId" value={recommendation.id} />
          ))}
          <button type="submit" className={buttonStyles.secondary}>换一批</button>
        </form>
        <form action={restDailyPlanAction}>
          <button type="submit" className={buttonStyles.ghost}>今日休息</button>
        </form>
      </div>
    </Card>
  );
}
