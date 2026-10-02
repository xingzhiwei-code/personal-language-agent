import type {
  Goal,
  KnowledgeItem,
  KnowledgeRelation,
  LearnerState,
  LearningTarget,
  Scenario,
  Wordlist,
} from '@/domain/entities';
import type { SkillKind } from '@/domain/enums';

/**
 * Main-goal binding deliberately outweighs every other factor combined. When
 * enough bound words exist, this guarantees the daily budget is filled from
 * the primary goal instead of merely making that outcome likely.
 */
export const RELEVANCE_WEIGHTS = {
  wordlistBinding: 6,
  tagMatch: 1.5,
  skillGap: 1,
  frequency: 1,
  graphRelation: 0.5,
} as const;

export interface PoolRelevanceInput {
  goal: Goal | null;
  targets: LearningTarget[];
  skillStates: LearnerState[];
  items: KnowledgeItem[];
  wordlists: Wordlist[];
  relations: KnowledgeRelation[];
  recentLearnedItemIds: string[];
  activeScenarios?: Scenario[];
  nowIso: string;
}

export interface ScoredPoolItem {
  item: KnowledgeItem;
  score: number;
  factors: {
    wordlistBinding: number;
    tagMatch: number;
    skillGap: number;
    frequency: number;
    graphRelation: number;
  };
  reason: string;
}

/** Pure, deterministic scoring for `status=new` knowledge items. */
export function scorePoolRelevance(input: PoolRelevanceInput): ScoredPoolItem[] {
  const wordlists = new Map(input.wordlists.map((wordlist) => [wordlist.id, wordlist]));
  const recent = new Set(input.recentLearnedItemIds);
  const relatedToRecent = new Set<string>();
  for (const relation of input.relations) {
    if (recent.has(relation.fromItemId)) relatedToRecent.add(relation.toItemId);
    if (recent.has(relation.toItemId)) relatedToRecent.add(relation.fromItemId);
  }
  const masteryBySkill = new Map(
    input.skillStates
      .filter((state) => state.subjectType === 'skill')
      .map((state) => [state.subjectId, state.mastery]),
  );
  const targetBySkill = new Map(input.targets.map((target) => [target.skill, target]));
  const keywords = goalKeywords(input.goal);
  const scenarioKeywords = activeScenarioKeywords(input);

  return input.items
    .filter((item) => item.status === 'new')
    .map((item) => {
      const wordlist = item.wordlistId ? wordlists.get(item.wordlistId) : undefined;
      const bound = input.goal && wordlist?.goalId === input.goal.id ? 1 : 0;
      const candidateTags = [...item.tags, ...(wordlist?.tags ?? [])].map(normalizeToken);
      const goalMatches = matchRatio(candidateTags, keywords);
      const scenarioMatch = scenarioKeywords.reduce(
        (best, entry) =>
          Math.max(
            best,
            entry.itemIds.has(item.id)
              ? entry.urgency
              : matchRatio(candidateTags, entry.keywords) * entry.urgency,
          ),
        0,
      );
      const tagMatch = clamp01(Math.max(goalMatches, scenarioMatch));
      const skill = skillForItem(item);
      const target = targetBySkill.get(skill);
      const mastery = masteryBySkill.get(skill);
      const skillGap = clamp01((1 - (mastery ?? 0.5)) * (target?.importance ?? 0.5));
      const frequency = item.frequencyRank === null ? 0.5 : clamp01(1 - item.frequencyRank);
      const graphRelation = relatedToRecent.has(item.id) ? 1 : 0;
      const factors = { wordlistBinding: bound, tagMatch, skillGap, frequency, graphRelation };
      const score = round(
        factors.wordlistBinding * RELEVANCE_WEIGHTS.wordlistBinding +
          factors.tagMatch * RELEVANCE_WEIGHTS.tagMatch +
          factors.skillGap * RELEVANCE_WEIGHTS.skillGap +
          factors.frequency * RELEVANCE_WEIGHTS.frequency +
          factors.graphRelation * RELEVANCE_WEIGHTS.graphRelation,
      );
      return { item, score, factors, reason: relevanceReason(factors, wordlist?.name ?? null) };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.item.frequencyRank ?? 0.5) - (b.item.frequencyRank ?? 0.5) ||
        a.item.createdAt.localeCompare(b.item.createdAt) ||
        a.item.id.localeCompare(b.item.id),
    );
}

function relevanceReason(
  factors: ScoredPoolItem['factors'],
  wordlistName: string | null,
): string {
  const reasons: string[] = [];
  if (factors.wordlistBinding > 0) reasons.push(`来自主目标绑定词库${wordlistName ? `「${wordlistName}」` : ''}`);
  if (factors.tagMatch > 0) reasons.push('标签与目标或活跃场景匹配');
  if (factors.skillGap >= 0.5) reasons.push('补足当前薄弱技能');
  if (factors.graphRelation > 0) reasons.push('与近期学习内容有关联');
  if (reasons.length === 0) reasons.push('按词频与稳定顺序补充通用词汇');
  else if (factors.frequency >= 0.7) reasons.push('词频优先');
  return reasons.join('；');
}

function goalKeywords(goal: Goal | null): string[] {
  if (!goal) return [];
  return tokenize([goal.title, goal.rawInput, goal.description ?? '', ...goal.scenarios].join(' '));
}

function activeScenarioKeywords(
  input: PoolRelevanceInput,
): { keywords: string[]; urgency: number; itemIds: Set<string> }[] {
  const now = Date.parse(input.nowIso);
  return (input.activeScenarios ?? [])
    .filter(
      (scenario) =>
        (!input.goal || !scenario.goalId || scenario.goalId === input.goal.id) &&
        (!scenario.timeContext?.resolvedDueAt || Date.parse(scenario.timeContext.resolvedDueAt) > now),
    )
    .map((scenario) => {
      const due = scenario.timeContext?.resolvedDueAt
        ? (Date.parse(scenario.timeContext.resolvedDueAt) - now) / 86_400_000
        : null;
      const urgency = due === null ? 0.5 : due <= 1 ? 1 : due <= 7 ? 0.8 : due <= 30 ? 0.65 : 0.5;
      return {
        keywords: tokenize(scenario.name),
        urgency,
        itemIds: new Set(scenario.knowledgeItemIds),
      };
    });
}

function skillForItem(item: KnowledgeItem): SkillKind {
  if (item.type === 'grammar' || item.type === 'pattern') return 'grammar';
  if (item.type === 'pronunciation') return 'pronunciation';
  if (item.type === 'sentence') return 'reading';
  return 'vocabulary';
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9]{2,}/g) ?? [];
  const cjk = lower.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return [...new Set([...latin, ...cjk].map(normalizeToken).filter(Boolean))];
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function matchRatio(tags: string[], keywords: string[]): number {
  if (tags.length === 0 || keywords.length === 0) return 0;
  let matches = 0;
  for (const tag of tags) {
    if (keywords.some((keyword) => keyword.includes(tag) || tag.includes(keyword))) matches += 1;
  }
  return matches / tags.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
