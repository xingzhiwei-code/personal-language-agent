'use client';

import { useId, useState } from 'react';
import {
  rejectRecommendationAction,
  startSessionAction,
} from '@/app/actions/learning';
import { ACTIVITY_LABELS, FACTOR_LABELS } from '@/components/labels';
import { Badge, buttonStyles, Card } from '@/components/ui';
import type { Recommendation } from '@/domain/entities';

/**
 * The single main action on the home screen: zero-to-one decision.
 * Rejecting requires no explanation and is not treated as a failure.
 */
export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const [pending, setPending] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const tokenId = useId();
  const clientToken = `rec-${recommendation.id}-${tokenId}`;

  return (
    <Card className="border-accent-100 bg-gradient-to-b from-accent-50/60 to-white">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          {ACTIVITY_LABELS[recommendation.activityType] ?? recommendation.activityType}
        </h2>
        <Badge tone="accent">约 {recommendation.plannedDurationMinutes} 分钟</Badge>
        {recommendation.estimatedItemCount > 0 ? (
          <Badge>{recommendation.estimatedItemCount} 个小任务</Badge>
        ) : null}
        {recommendation.requiresAi ? <Badge tone="ai">需要 AI</Badge> : null}
      </div>

      <p className="mt-2 text-sm text-ink-600">{recommendation.reason}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form action={startSessionAction} onSubmit={() => setPending(true)}>
          <input type="hidden" name="activityType" value={recommendation.activityType} />
          <input type="hidden" name="minutes" value={recommendation.plannedDurationMinutes} />
          <input type="hidden" name="recommendationId" value={recommendation.id} />
          <input type="hidden" name="clientToken" value={clientToken} />
          <button
            type="submit"
            className={buttonStyles.primary}
            disabled={pending}
            data-testid="start-recommendation"
          >
            {pending ? '正在准备…' : '开始'}
          </button>
        </form>

        <form action={rejectRecommendationAction}>
          <input type="hidden" name="recommendationId" value={recommendation.id} />
          <button type="submit" className={buttonStyles.ghost}>
            换一个
          </button>
        </form>

        <button
          type="button"
          className={buttonStyles.ghost}
          onClick={() => setShowWhy((value) => !value)}
          aria-expanded={showWhy}
        >
          {showWhy ? '收起说明' : '为什么推荐这个'}
        </button>
      </div>

      {showWhy ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-white/80 p-3 text-xs text-ink-600 sm:grid-cols-3">
          {Object.entries(recommendation.factors).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2">
              <dt className="text-ink-400">{FACTOR_LABELS[key] ?? key}</dt>
              <dd className="tabular-nums">{Number(value).toFixed(2)}</dd>
            </div>
          ))}
          <div className="col-span-full mt-1 border-t border-ink-100 pt-1 text-ink-400">
            这些分数由本地确定性规则计算，不经过 AI。总分 {recommendation.score.toFixed(2)}。
          </div>
        </dl>
      ) : null}
    </Card>
  );
}
