import type { PhaseProgress } from '@/application/phases';
import { Badge } from '@/components/ui';
import type { GoalPhase } from '@/domain/entities';

/**
 * v0.4 §G5 — the home path bar. Phase nodes (current / done / locked), the
 * active phase's per-criterion exit progress, and a one-line preview of the
 * next phase. Information only: no time promises, no anxiety copy.
 */
export function PathBar({
  phases,
  progress,
}: {
  phases: GoalPhase[];
  progress: Record<string, PhaseProgress>;
}) {
  if (phases.length === 0) return null;
  const active = phases.find((phase) => phase.status === 'active');
  const next = active ? phases.find((phase) => phase.seq === active.seq + 1) : undefined;
  const activeProgress = active ? progress[active.id] : undefined;

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {phases.map((phase, index) => (
          <div key={phase.id} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-ink-300">→</span> : null}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                phase.status === 'active'
                  ? 'bg-accent-500 text-white'
                  : phase.status === 'done'
                    ? 'bg-accent-100 text-accent-600'
                    : 'bg-ink-100 text-ink-400'
              }`}
            >
              {phase.status === 'done' ? '✓ ' : ''}
              {phase.name}
            </span>
          </div>
        ))}
      </div>

      {active && activeProgress && activeProgress.items.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-ink-400">本阶段进度（只看数据，不看时间）</p>
          {activeProgress.items.map((item) => (
            <div key={item.metric} className="flex items-center justify-between gap-2 text-xs">
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
            </div>
          ))}
        </div>
      ) : null}

      {next ? (
        <p className="mt-3 border-t border-ink-100 pt-2 text-xs text-ink-400">
          下一阶段：{next.name} — {next.description}
        </p>
      ) : null}

      {active && activeProgress?.exitMet ? (
        <div className="mt-3">
          <Badge tone="accent">已满足本阶段准出，可进入下一阶段</Badge>
        </div>
      ) : null}
    </div>
  );
}
