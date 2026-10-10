'use client';

import { useState } from 'react';
import { advancePhaseAction, rollbackPhaseAction, skipPhaseAction } from '@/app/actions/learning';
import type { PhaseProgress } from '@/application/phases';
import { Badge, buttonStyles } from '@/components/ui';
import type { GoalPhase } from '@/domain/entities';

/**
 * Goal phase path (v0.4 §G2 / §G5): node states, per-criterion exit progress,
 * and the user-confirmed transitions. No time promises, no anxiety copy.
 */
export function PhaseList({
  goalId,
  phases,
  progress,
  isPrimary,
}: {
  goalId: string;
  phases: GoalPhase[];
  progress: Record<string, PhaseProgress>;
  isPrimary: boolean;
}) {
  const [confirming, setConfirming] = useState<'advance' | 'skip' | 'rollback' | null>(null);

  if (phases.length === 0) return null;

  return (
    <div className="mt-4 border-t border-ink-100 pt-3">
      <p className="text-xs text-ink-400">
        {isPrimary ? '目标阶段（只看数据，不看时间）' : '阶段快照 · 保温中，进度已保留'}
      </p>
      <ol className="mt-2 space-y-2">
        {phases.map((phase) => {
          const p = progress[phase.id];
          return (
            <li
              key={phase.id}
              className={`rounded-xl border p-3 ${
                phase.status === 'active'
                  ? 'border-accent-200 bg-accent-50/50'
                  : phase.status === 'done'
                    ? 'border-ink-100 bg-white'
                    : 'border-ink-100 bg-ink-50/50 opacity-70'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-400">P{phase.seq}</span>
                <span className="font-medium">{phase.name}</span>
                {phase.status === 'active' ? <Badge tone="accent">当前阶段</Badge> : null}
                {phase.status === 'done' ? <Badge>✓ 已完成</Badge> : null}
                {phase.status === 'locked' ? <Badge>未解锁</Badge> : null}
              </div>
              {phase.description ? (
                <p className="mt-1 text-xs text-ink-400">{phase.description}</p>
              ) : null}

              {p && p.items.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {p.items.map((item) => (
                    <li key={item.metric} className="flex items-center justify-between gap-2 text-xs">
                      <span className={item.met ? 'text-ink-600' : 'text-ink-500'}>
                        {item.met ? '✓ ' : '· '}
                        {item.label}
                      </span>
                      <span className="tabular-nums text-ink-400">
                        {item.measured
                          ? item.metric === 'placement_retest'
                            ? `当前 ${item.current}`
                            : `当前 ${Math.round((item.current ?? 0) * 100)}%`
                          : '尚未测量'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {isPrimary && phase.status === 'active' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p?.exitMet && phases.some((next) => next.seq === phase.seq + 1) ? (
                    confirming === 'advance' ? (
                      <ConfirmRow
                        message="进入下一阶段？"
                        onCancel={() => setConfirming(null)}
                        formAction={advancePhaseAction}
                        goalId={goalId}
                      />
                    ) : (
                      <button
                        type="button"
                        className={buttonStyles.primary}
                        onClick={() => setConfirming('advance')}
                      >
                        进入下一阶段
                      </button>
                    )
                  ) : null}

                  {phases.some((next) => next.seq === phase.seq + 1) && confirming !== 'skip' ? (
                    <button
                      type="button"
                      className={buttonStyles.ghost}
                      onClick={() => setConfirming('skip')}
                    >
                      跳过本阶段
                    </button>
                  ) : null}
                  {phase.seq > 1 && confirming !== 'rollback' ? (
                    <button
                      type="button"
                      className={buttonStyles.ghost}
                      onClick={() => setConfirming('rollback')}
                    >
                      回退上一阶段
                    </button>
                  ) : null}

                  {confirming === 'skip' ? (
                    <ConfirmRow
                      message="确认跳过本阶段？已学数据与记录不会丢失。"
                      onCancel={() => setConfirming(null)}
                      formAction={skipPhaseAction}
                      goalId={goalId}
                    />
                  ) : null}
                  {confirming === 'rollback' ? (
                    <ConfirmRow
                      message="确认回退到上一阶段？已学数据与记录不会丢失。"
                      onCancel={() => setConfirming(null)}
                      formAction={rollbackPhaseAction}
                      goalId={goalId}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ConfirmRow({
  message,
  onCancel,
  formAction,
  goalId,
}: {
  message: string;
  onCancel: () => void;
  formAction: (formData: FormData) => void;
  goalId: string;
}) {
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="goalId" value={goalId} />
      <span className="text-xs text-ink-600">{message}</span>
      <button type="submit" className={buttonStyles.primary} data-testid="confirm-phase-action">
        确认
      </button>
      <button type="button" className={buttonStyles.ghost} onClick={onCancel}>
        取消
      </button>
    </form>
  );
}
