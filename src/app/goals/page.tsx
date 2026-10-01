import { listGoalsWithTargets } from '@/application/goals';
import { GoalForm } from '@/components/GoalForm';
import { SKILL_LABELS } from '@/components/labels';
import { Badge, Card, EmptyState, Meter, SectionTitle } from '@/components/ui';
import { GoalStatusForm } from '@/components/goals/GoalStatusForm';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  archived: '已归档',
};

export default async function GoalsPage() {
  const { ctx, learnerId } = app();
  const goals = await listGoalsWithTargets(ctx, learnerId);
  const skillStates = await ctx.repos.states.listBySubjectType(learnerId, 'skill');

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">学习目标</h1>
        <p className="mt-1 text-sm text-ink-600">
          目标和技能权重都可以改。系统对你的能力估计只是假设，你可以随时纠正。
        </p>
      </header>

      {goals.length === 0 ? (
        <EmptyState title="还没有目标" description="用一句话描述你想达到什么。" />
      ) : (
        goals.map(({ goal, targets }) => (
          <Card key={goal.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{goal.title}</h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={goal.status === 'active' ? 'accent' : 'neutral'}>
                    {STATUS_LABELS[goal.status]}
                  </Badge>
                  {goal.isPrimary ? <Badge tone="accent">主要目标</Badge> : null}
                  {goal.scenarios.map((scenario) => (
                    <Badge key={scenario}>{scenario}</Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-400">原话：{goal.rawInput}</p>
              </div>
              <GoalStatusForm
                goalId={goal.id}
                status={goal.status}
                isPrimary={goal.isPrimary}
              />
            </div>

            <div className="mt-4 space-y-2 border-t border-ink-100 pt-3">
              <p className="text-xs text-ink-400">目标涉及的技能与当前估计</p>
              {targets.map((target) => {
                const state = skillStates.find((entry) => entry.subjectId === target.skill);
                return (
                  <div key={target.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span>{SKILL_LABELS[target.skill]}</span>
                      <span className="text-ink-400">
                        重要度 {Math.round(target.importance * 100)}%
                        {state && state.exposureCount > 0
                          ? ` · 置信度 ${Math.round(state.confidence * 100)}%`
                          : ' · 还没有数据'}
                      </span>
                    </div>
                    <Meter value={state?.mastery ?? 0} label={SKILL_LABELS[target.skill]} />
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}

      <section>
        <SectionTitle title="添加新目标" />
        <Card>
          <GoalForm redirectTo="/goals" />
        </Card>
      </section>
    </div>
  );
}
