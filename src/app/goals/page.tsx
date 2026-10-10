import { listGoalsWithTargets } from '@/application/goals';
import { getPlacementView } from '@/application/placement';
import { listScenarios } from '@/application/scenarios';
import { GoalForm } from '@/components/GoalForm';
import { GoalStatusForm } from '@/components/goals/GoalStatusForm';
import { ScenarioManager } from '@/components/goals/ScenarioManager';
import { WordlistGoalBinding } from '@/components/goals/WordlistGoalBinding';
import { SKILL_LABELS } from '@/components/labels';
import { Badge, Card, EmptyState, LinkButton, Meter, SectionTitle } from '@/components/ui';
import type { KnowledgeItem, LearnerState, Scenario, Wordlist } from '@/domain/entities';
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
  const goalEntities = goals.map(({ goal }) => goal);
  const placementView = await getPlacementView(ctx, learnerId);
  const [skillStates, knowledgeStates, scenarios, wordlists, knowledgeItems] = await Promise.all([
    ctx.repos.states.listBySubjectType(learnerId, 'skill'),
    ctx.repos.states.listBySubjectType(learnerId, 'knowledge_item'),
    listScenarios(ctx, learnerId),
    ctx.repos.wordlists.listByLearner(learnerId),
    ctx.repos.knowledge.search({ learnerId, limit: 20_000 }),
  ]);
  const scenarioReadiness = buildScenarioReadiness(scenarios, knowledgeStates);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">学习目标</h1>
        <p className="mt-1 text-sm text-ink-600">
          目标和技能权重都可以改。系统对你的能力估计只是假设，你可以随时纠正。
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs text-ink-400">当前起点</span>
            <span className="ml-2 text-xl font-semibold tabular-nums">
              {placementView.placement ? placementView.placement.overallLevel : '未校准'}
            </span>
            {placementView.placement ? (
              <span className="ml-2 text-xs text-ink-400">
                {placementView.placement.evidence.includes('override')
                  ? '手动覆盖'
                  : placementView.placement.evidence.includes('test')
                    ? '摸底估算'
                    : '自述'}
              </span>
            ) : null}
          </div>
          <LinkButton href="/placement" variant="secondary">
            {placementView.placement ? '重新校准起点' : '校准起点'}
          </LinkButton>
        </div>
      </Card>

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
                          ? ` · 置信度 ${Math.round(state.confidence * 100)}% · 趋势 ${trendLabel(state.trend)}`
                          : ' · 还没有数据'}
                      </span>
                    </div>
                    <Meter value={state?.mastery ?? 0} label={SKILL_LABELS[target.skill]} />
                  </div>
                );
              })}
            </div>
            <GoalCoverage
              goalId={goal.id}
              wordlists={wordlists}
              knowledgeItems={knowledgeItems}
              scenarioCount={scenarios.filter((scenario) => scenario.goalId === goal.id && scenario.status === 'active').length}
            />
          </Card>
        ))
      )}

      <section>
        <SectionTitle title="词库与目标" hint="绑定后会参与后续的新词相关性排序" />
        {wordlists.length === 0 ? (
          <EmptyState title="还没有词库" description="先从知识库导入一个词库，再回来绑定目标。" />
        ) : (
          <Card className="space-y-2">
            {wordlists.map((wordlist) => (
              <WordlistGoalBinding key={wordlist.id} wordlist={wordlist} goals={goalEntities} />
            ))}
          </Card>
        )}
      </section>

      <section>
        <SectionTitle title="场景" hint="只有你手动声明的场景会生效；到期后自动归档" />
        <ScenarioManager
          scenarios={scenarios}
          goals={goalEntities}
          readiness={scenarioReadiness}
          knowledgeItems={knowledgeItems}
        />
      </section>

      <section>
        <SectionTitle title="添加新目标" />
        <Card>
          <GoalForm redirectTo="/goals" />
        </Card>
      </section>
    </div>
  );
}

function GoalCoverage({
  goalId,
  wordlists,
  knowledgeItems,
  scenarioCount,
}: {
  goalId: string;
  wordlists: Wordlist[];
  knowledgeItems: KnowledgeItem[];
  scenarioCount: number;
}) {
  const ids = new Set(wordlists.filter((wordlist) => wordlist.goalId === goalId).map((wordlist) => wordlist.id));
  const related = knowledgeItems.filter((item) => item.wordlistId && ids.has(item.wordlistId));
  const learning = related.filter((item) => item.status === 'active' || item.status === 'user_mastered').length;
  const coverage = related.length > 0 ? learning / related.length : 0;
  return (
    <div className="mt-4 grid gap-3 border-t border-ink-100 pt-3 sm:grid-cols-2">
      <div>
        <div className="flex justify-between text-xs text-ink-400">
          <span>词汇覆盖率</span>
          <span>{learning} / {related.length}</span>
        </div>
        <Meter value={coverage} label="词汇覆盖率" />
      </div>
      <div className="rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">
        绑定词库 {ids.size} 个 · 活跃场景 {scenarioCount} 个
      </div>
    </div>
  );
}

function trendLabel(trend: string): string {
  return ({ improving: '上升', stable: '稳定', declining: '下降', unknown: '待观察' } as Record<string, string>)[trend] ?? '待观察';
}

function buildScenarioReadiness(
  scenarios: Scenario[],
  states: LearnerState[],
): Record<string, { bound: number; mastery: number }> {
  const mastery = new Map(states.map((state) => [state.subjectId, state.mastery]));
  const output: Record<string, { bound: number; mastery: number }> = {};
  for (const scenario of scenarios) {
    const childIds =
      scenario.type === 'big'
        ? scenarios
            .filter((candidate) => candidate.parentId === scenario.id)
            .flatMap((candidate) => candidate.knowledgeItemIds)
        : [];
    const ids = [...new Set([...scenario.knowledgeItemIds, ...childIds])];
    output[scenario.id] = {
      bound: ids.length,
      mastery:
        ids.length > 0
          ? ids.reduce((sum, id) => sum + (mastery.get(id) ?? 0), 0) / ids.length
          : 0,
    };
  }
  return output;
}
