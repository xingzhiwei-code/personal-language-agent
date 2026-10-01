import type { ChatMessage, LearningSession } from '@/domain/entities';
import type { Intent } from '@/domain/enums';
import type { AppContext } from '@/application/types';
import { getCurrentContext } from '@/application/context';
import { languageLabel } from '@/language/registry';
import { detectErrorPatterns } from '@/learner/skills';

/** How many chat turns are sent to the model. Never the whole history. */
export const MAX_HISTORY_TURNS = 6;

export interface AgentContext {
  languageCode: string;
  languageLabel: string;
  goalTitle: string | null;
  scenarios: string[];
  weakSkills: { skill: string; mastery: number; confidence: number }[];
  recentErrors: string[];
  relatedKnowledge: { text: string; meaning: string | null }[];
  memories: string[];
  availableMinutes: number | null;
  intent: Intent;
  correctionEnabled: boolean;
  dueCount: number;
}

/**
 * Builds a *small*, task-relevant context (PRD §18): current goal, relevant
 * skills, recent errors, relevant memory, session, available time, intent,
 * related knowledge and preferences. The whole database and the whole chat
 * history are never sent to the model.
 */
export async function buildAgentContext(
  ctx: AppContext,
  learnerId: string,
  options: { term?: string | null; session?: LearningSession | null; intent: Intent },
): Promise<AgentContext> {
  const goal = await ctx.repos.goals.findPrimary(learnerId);
  const languageCode = goal?.languageCode ?? 'en';
  const targets = goal ? await ctx.repos.targets.listByGoal(goal.id) : [];
  const skillStates = await ctx.repos.states.listBySubjectType(learnerId, 'skill');

  const weakSkills = targets
    .map((target) => {
      const state = skillStates.find((entry) => entry.subjectId === target.skill);
      return {
        skill: target.skill,
        mastery: state?.mastery ?? 0,
        confidence: state?.confidence ?? 0,
      };
    })
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 3);

  const recentAssessments = await ctx.repos.assessments.listByLearner(learnerId, 12);
  const failedIds = [
    ...new Set(
      recentAssessments
        .filter((assessment) => !assessment.correct)
        .map((assessment) => assessment.subjectId),
    ),
  ].slice(0, 5);
  const failedItems = await ctx.repos.knowledge.listByIds(failedIds);

  const related = options.term
    ? await ctx.repos.knowledge.search({
        learnerId,
        text: options.term,
        statuses: ['active'],
        limit: 4,
      })
    : await ctx.repos.knowledge.search({ learnerId, statuses: ['active'], limit: 4 });

  const memories = (await ctx.repos.memories.listByLearner(learnerId, ['active']))
    .filter((memory) => memory.confidence >= 0.4)
    .slice(0, 5)
    .map((memory) => memory.content);

  const userContext = await getCurrentContext(ctx, learnerId);
  const dueStates = await ctx.repos.states.listDueForReview(
    learnerId,
    ctx.clock.nowIso(),
    50,
  );

  const errorPatterns = skillStates
    .flatMap((state) =>
      detectErrorPatterns(state).map((pattern) => `${state.subjectId}:${pattern.modality}`),
    )
    .slice(0, 3);

  return {
    languageCode,
    languageLabel: languageLabel(languageCode),
    goalTitle: goal?.title ?? null,
    scenarios: goal?.scenarios ?? [],
    weakSkills,
    recentErrors: [
      ...failedItems.map((item) => item.text),
      ...errorPatterns,
    ].slice(0, 6),
    relatedKnowledge: related.map((item) => ({ text: item.text, meaning: item.meaning })),
    memories,
    availableMinutes: userContext?.availableMinutes ?? null,
    intent: options.intent,
    correctionEnabled: options.session?.correctionEnabled ?? true,
    dueCount: dueStates.length,
  };
}

export function renderSystemPrompt(context: AgentContext): string {
  const lines: string[] = [
    `你是用户的个人语言学习伙伴。目标语言：${context.languageLabel}；用户界面语言：中文。`,
    '规则：',
    '1. 先直接回答用户的问题或回应用户的话，不要先讲学习计划。',
    '2. 不要把自由聊天强行变成课程；不要因为用户没复习而责备他。',
    context.correctionEnabled
      ? '3. 如果用户的表达有影响理解的错误，用一句话温和指出并给出更自然的说法。'
      : '3. 用户本次关闭了纠错：不要主动纠正语法、用词或发音，除非用户直接询问。',
    '4. 回答简洁（中文不超过 150 字），最多给 2 个例句。',
    '5. 不要编造来源或数据；不确定就说不确定。',
  ];

  if (context.goalTitle) lines.push(`用户目标：${context.goalTitle}`);
  if (context.scenarios.length > 0) lines.push(`使用场景：${context.scenarios.join('、')}`);
  if (context.weakSkills.length > 0) {
    lines.push(
      `相对薄弱：${context.weakSkills
        .map((skill) => `${skill.skill}(${Math.round(skill.mastery * 100)}%)`)
        .join('、')}`,
    );
  }
  if (context.recentErrors.length > 0) {
    lines.push(`最近出错过：${context.recentErrors.join('、')}`);
  }
  if (context.relatedKnowledge.length > 0) {
    lines.push(
      `用户知识库里的相关条目：${context.relatedKnowledge
        .map((item) => item.text)
        .join('、')}`,
    );
  }
  if (context.memories.length > 0) lines.push(`长期记忆：${context.memories.join('；')}`);
  if (context.availableMinutes) lines.push(`用户当前可用时间：${context.availableMinutes} 分钟`);

  return lines.join('\n');
}

export function toLlmHistory(messages: ChatMessage[]): {
  role: 'user' | 'assistant';
  content: string;
}[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_HISTORY_TURNS)
    .map((message) => ({
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.text,
    }));
}
