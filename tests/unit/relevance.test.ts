import { describe, expect, it } from 'vitest';
import type {
  Goal,
  KnowledgeItem,
  KnowledgeRelation,
  LearnerState,
  LearningTarget,
  Scenario,
  Wordlist,
} from '@/domain/entities';
import { createInitialState } from '@/learner/state';
import { RELEVANCE_WEIGHTS, scorePoolRelevance } from '@/scheduler/relevance';

const NOW = '2026-01-10T10:00:00.000Z';
const goal: Goal = {
  id: 'goal-main',
  learnerId: 'learner',
  languageCode: 'en',
  title: '雅思词汇 7 分',
  rawInput: '我要准备雅思 IELTS 考试',
  description: null,
  scenarios: ['考试'],
  status: 'active',
  priority: 1,
  isPrimary: true,
  goalType: 'general',
  createdAt: NOW,
  updatedAt: NOW,
};
const target: LearningTarget = {
  id: 'target-vocab',
  goalId: goal.id,
  learnerId: 'learner',
  skill: 'vocabulary',
  importance: 1,
  description: null,
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
};
const state: LearnerState = {
  ...createInitialState({
    id: 'skill-state',
    learnerId: 'learner',
    subjectType: 'skill',
    subjectId: 'vocabulary',
    nowIso: NOW,
  }),
  mastery: 0.2,
};

function item(id: string, partial: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    learnerId: 'learner',
    languageCode: 'en',
    type: 'word',
    text: id,
    normalizedText: id,
    meaning: null,
    notes: null,
    examples: [],
    tags: [],
    origin: 'user',
    sourceType: 'user_import',
    sourceId: null,
    sourceRef: null,
    aiGenerated: false,
    status: 'new',
    wordlistId: null,
    entryMethod: 'file_upload',
    frequencyRank: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function wordlist(id: string, partial: Partial<Wordlist> = {}): Wordlist {
  return {
    id,
    learnerId: 'learner',
    name: id,
    languageCode: 'en',
    goalId: null,
    tags: [],
    sourceFile: null,
    itemCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function score(partial: Partial<Parameters<typeof scorePoolRelevance>[0]> = {}) {
  return scorePoolRelevance({
    goal,
    targets: [target],
    skillStates: [state],
    items: [],
    wordlists: [],
    relations: [],
    recentLearnedItemIds: [],
    activeScenarios: [],
    nowIso: NOW,
    ...partial,
  });
}

describe('M7: deterministic pool relevance', () => {
  it('keeps all weights centralized and main-goal binding dominates other factors', () => {
    expect(RELEVANCE_WEIGHTS.wordlistBinding).toBeGreaterThan(
      RELEVANCE_WEIGHTS.tagMatch +
        RELEVANCE_WEIGHTS.skillGap +
        RELEVANCE_WEIGHTS.frequency +
        RELEVANCE_WEIGHTS.graphRelation,
    );
    const bound = item('bound', { wordlistId: 'wl-bound', frequencyRank: 1 });
    const generic = item('generic', { tags: ['ielts'], frequencyRank: 0 });
    const ranked = score({
      items: [generic, bound],
      wordlists: [wordlist('wl-bound', { goalId: goal.id }), wordlist('wl-generic')],
    });
    expect(ranked.map((entry) => entry.item.id)).toEqual(['bound', 'generic']);
    expect(ranked[0]?.reason).toContain('主目标绑定词库');
  });

  it('uses tag, skill gap, frequency and graph relation in the expected direction', () => {
    const related: KnowledgeRelation = {
      id: 'rel',
      learnerId: 'learner',
      fromItemId: 'recent',
      toItemId: 'candidate',
      type: 'related',
      note: null,
      createdAt: NOW,
    };
    const ranked = score({
      items: [
        item('candidate', { tags: ['ielts'], frequencyRank: 0 }),
        item('plain', { frequencyRank: 1 }),
      ],
      relations: [related],
      recentLearnedItemIds: ['recent'],
    });
    expect(ranked[0]?.item.id).toBe('candidate');
    expect(ranked[0]?.factors).toMatchObject({ tagMatch: 1, skillGap: 0.8, frequency: 1, graphRelation: 1 });
  });

  it('folds only user-declared active scenario urgency into tag matching', () => {
    const scenario: Scenario = {
      id: 'scenario',
      learnerId: 'learner',
      goalId: goal.id,
      parentId: null,
      name: '客户会议',
      type: 'big',
      timeContext: { preset: 'today', freeText: null, resolvedDueAt: '2026-01-10T20:00:00.000Z' },
      status: 'active',
      knowledgeItemIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const ranked = score({
      items: [item('meeting', { tags: ['客户会议'] }), item('plain')],
      activeScenarios: [scenario],
    });
    expect(ranked[0]?.item.id).toBe('meeting');
    expect(ranked[0]?.factors.tagMatch).toBe(1);
  });

  it('falls back to frequency and stable IDs when no goal metadata exists', () => {
    const input = {
      goal: null,
      targets: [],
      skillStates: [],
      items: [
        item('z-last', { frequencyRank: 0.8 }),
        item('b-tie', { frequencyRank: null }),
        item('a-tie', { frequencyRank: null }),
        item('first', { frequencyRank: 0 }),
      ],
      wordlists: [],
      relations: [],
      recentLearnedItemIds: [],
      activeScenarios: [],
      nowIso: NOW,
    };
    const first = scorePoolRelevance(input);
    const second = scorePoolRelevance(input);
    expect(first.map((entry) => entry.item.id)).toEqual(['first', 'a-tie', 'b-tie', 'z-last']);
    expect(second.map((entry) => entry.item.id)).toEqual(first.map((entry) => entry.item.id));
    expect(first[0]?.reason).toContain('词频');
  });

  it('returns every available pool item and filters non-pool statuses', () => {
    const ranked = score({
      items: [item('new-1'), item('new-2'), item('active', { status: 'active' })],
    });
    expect(ranked.map((entry) => entry.item.id).sort()).toEqual(['new-1', 'new-2']);
  });
});
