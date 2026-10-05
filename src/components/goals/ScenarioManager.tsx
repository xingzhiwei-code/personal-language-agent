'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import {
  createScenarioAction,
  deleteScenarioAction,
  unbindItemFromScenarioAction,
  updateScenarioAction,
} from '@/app/actions/scenarios';
import { Badge, buttonStyles, Card, ErrorNote } from '@/components/ui';
import type { Goal, KnowledgeItem, Scenario } from '@/domain/entities';
import type { ActionResult } from '@/server/app';

const TIME_OPTIONS = [
  ['', '不设期限'],
  ['today', '今天'],
  ['this_week', '本周'],
  ['next_week', '下周'],
  ['this_month', '本月'],
  ['this_quarter', '本季度'],
  ['long_term', '长期'],
] as const;

export function ScenarioManager({
  scenarios,
  goals,
  readiness,
  knowledgeItems = [],
}: {
  scenarios: Scenario[];
  goals: Goal[];
  readiness: Record<string, { bound: number; mastery: number }>;
  knowledgeItems?: KnowledgeItem[];
}) {
  const router = useRouter();
  const [type, setType] = useState<'big' | 'small'>('big');
  const [createState, createAction, creating] = useActionState<
    ActionResult<{ id: string }> | null,
    FormData
  >(createScenarioAction, null);
  const bigScenarios = scenarios.filter((scenario) => scenario.type === 'big');
  const knowledgeById = new Map(knowledgeItems.map((item) => [item.id, item]));

  useEffect(() => {
    if (createState?.ok) router.refresh();
  }, [createState, router]);

  return (
    <div className="space-y-4">
      <Card>
        <form action={createAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-ink-400">
              场景名称
              <input name="name" required maxLength={120} placeholder="例如：下周出国旅行" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900" />
            </label>
            <label className="text-xs text-ink-400">
              类型
              <select name="type" value={type} onChange={(event) => setType(event.target.value as 'big' | 'small')} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900">
                <option value="big">大场景</option>
                <option value="small">小场景</option>
              </select>
            </label>
            {type === 'small' ? (
              <label className="text-xs text-ink-400">
                所属大场景
                <select name="parentId" required defaultValue="" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900">
                  <option value="" disabled>请选择</option>
                  {bigScenarios.filter((scenario) => scenario.status === 'active').map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-xs text-ink-400">
                时间范围
                <select name="timePreset" defaultValue="" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900">
                  {TIME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )}
            <label className="text-xs text-ink-400">
              绑定目标（可选）
              <select name="goalId" defaultValue="" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900">
                <option value="">独立场景</option>
                {goals.filter((goal) => goal.status === 'active').map((goal) => (
                  <option key={goal.id} value={goal.id}>{goal.isPrimary ? '主攻 · ' : ''}{goal.title}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs text-ink-400">
            时间说明（可选，仅展示）
            <input name="timeText" maxLength={120} placeholder="例如：下周三出发" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900" />
          </label>
          {createState && !createState.ok ? <ErrorNote>{createState.message}</ErrorNote> : null}
          {createState?.ok ? <p role="status" className="text-sm text-accent-600">{createState.message}</p> : null}
          <button type="submit" className={buttonStyles.primary} disabled={creating || (type === 'small' && bigScenarios.length === 0)}>
            {creating ? '创建中…' : '创建场景'}
          </button>
          {type === 'small' && bigScenarios.length === 0 ? <p className="text-xs text-amber-700">请先创建一个大场景。</p> : null}
        </form>
      </Card>

      {bigScenarios.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 p-5 text-center text-sm text-ink-400">还没有场景。场景只能由你主动创建，系统不会从对话中偷偷推断。</p>
      ) : (
        <div className="space-y-3">
          {bigScenarios.map((scenario) => (
            <div key={scenario.id}>
              <ScenarioEditor
                scenario={scenario}
                goals={goals}
                readiness={readiness[scenario.id]}
                knowledgeById={knowledgeById}
              />
              <div className="ml-5 mt-2 space-y-2 border-l-2 border-ink-100 pl-4">
                {scenarios.filter((child) => child.parentId === scenario.id).map((child) => (
                  <ScenarioEditor
                    key={child.id}
                    scenario={child}
                    goals={goals}
                    readiness={readiness[child.id]}
                    knowledgeById={knowledgeById}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioEditor({
  scenario,
  goals,
  readiness,
  knowledgeById,
}: {
  scenario: Scenario;
  goals: Goal[];
  readiness?: { bound: number; mastery: number };
  knowledgeById: Map<string, KnowledgeItem>;
}) {
  const router = useRouter();
  const [updateState, updateAction, updating] = useActionState<ActionResult | null, FormData>(updateScenarioAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(deleteScenarioAction, null);
  const [unbindState, unbindAction] = useActionState<ActionResult | null, FormData>(
    unbindItemFromScenarioAction,
    null,
  );
  useEffect(() => {
    if (updateState?.ok || deleteState?.ok || unbindState?.ok) router.refresh();
  }, [updateState, deleteState, unbindState, router]);

  return (
    <Card className={scenario.status === 'done' ? 'bg-ink-50' : ''}>
      <form action={updateAction} className="space-y-3">
        <input type="hidden" name="scenarioId" value={scenario.id} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={scenario.type === 'big' ? 'accent' : 'neutral'}>{scenario.type === 'big' ? '大场景' : '小场景'}</Badge>
          <Badge tone={scenario.status === 'active' ? 'accent' : 'neutral'}>{scenario.status === 'active' ? '进行中' : '已完成'}</Badge>
          {scenario.timeContext ? <span className="text-xs text-ink-400">{timeLabel(scenario.timeContext.preset)} · {scenario.timeContext.resolvedDueAt ? new Date(scenario.timeContext.resolvedDueAt).toLocaleDateString('zh-CN') : '无期限'}</span> : null}
          <span className="text-xs text-ink-400">
            {readiness && readiness.bound > 0
              ? `准备度 ${Math.round(readiness.mastery * 100)}% · ${readiness.bound} 条表达`
              : '尚未绑定表达'}
          </span>
        </div>
        <div className={`grid gap-3 ${scenario.type === 'big' ? 'sm:grid-cols-4' : 'sm:grid-cols-[1fr_180px_130px]'}`}>
          <label className="text-xs text-ink-400">
            名称
            <input name="name" required maxLength={120} defaultValue={scenario.name} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900" />
          </label>
          <label className="text-xs text-ink-400">
            目标
            <select name="goalId" defaultValue={scenario.goalId ?? ''} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900">
              <option value="">独立场景</option>
              {goals.filter((goal) => goal.status === 'active').map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select>
          </label>
          {scenario.type === 'big' ? (
            <label className="text-xs text-ink-400">
              时间范围
              <select name="timePreset" defaultValue={scenario.timeContext?.preset ?? ''} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900">
                {TIME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="text-xs text-ink-400">
            状态
            <select name="status" defaultValue={scenario.status} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900">
              <option value="active">进行中</option>
              <option value="done">已完成</option>
            </select>
          </label>
        </div>
        {updateState && !updateState.ok ? <ErrorNote>{updateState.message}</ErrorNote> : null}
        {deleteState && !deleteState.ok ? <ErrorNote>{deleteState.message}</ErrorNote> : null}
        <div className="flex gap-2">
          <button type="submit" className={buttonStyles.ghost} disabled={updating}>保存</button>
          <button type="submit" formAction={deleteAction} className="text-xs text-red-600" disabled={deleting}>删除</button>
        </div>
      </form>

      <div className="mt-4 border-t border-ink-100 pt-3">
        {scenario.knowledgeItemIds.length === 0 ? (
          <p className="text-xs text-ink-400">
            尚未绑定表达，
            <Link href="/knowledge?status=pool" className="text-accent-600 underline">
              去词库池挑选
            </Link>
            。
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {scenario.knowledgeItemIds.map((id) => {
              const item = knowledgeById.get(id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-1.5 rounded-full border border-ink-200 px-2 py-0.5 text-xs text-ink-600"
                >
                  <Link href={`/knowledge/${id}`} className="hover:text-accent-600">
                    {item?.text ?? id}
                  </Link>
                  <form action={unbindAction}>
                    <input type="hidden" name="scenarioId" value={scenario.id} />
                    <input type="hidden" name="itemId" value={id} />
                    <button
                      type="submit"
                      className="text-ink-400 hover:text-red-600"
                      aria-label={`从场景移除 ${item?.text ?? id}`}
                    >
                      ×
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function timeLabel(preset: Scenario['timeContext'] extends infer _T ? string : never): string {
  return ({ today: '今天', this_week: '本周', next_week: '下周', this_month: '本月', this_quarter: '本季度', long_term: '长期' } as Record<string, string>)[preset] ?? preset;
}
