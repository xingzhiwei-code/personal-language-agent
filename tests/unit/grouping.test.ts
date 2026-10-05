import { describe, expect, it } from 'vitest';
import { MAX_REQUEUE_ROUNDS, canRequeue, orderByLadder } from '@/assessment/grouping';
import { gradeTextAnswer } from '@/assessment/grading';
import { buildReviewItems, type ReviewItemSpec } from '@/assessment/review-items';
import type { KnowledgeItem } from '@/domain/entities';
import { normalizeKnowledgeText } from '@/language/registry';

const NOW = '2026-01-10T10:00:00.000Z';

function item(partial: Partial<KnowledgeItem> & { id: string; text: string }): KnowledgeItem {
  return {
    learnerId: 'learner-1',
    languageCode: 'en',
    type: 'word',
    normalizedText: normalizeKnowledgeText('en', partial.text),
    meaning: null,
    notes: null,
    examples: [],
    tags: [],
    origin: 'user',
    sourceType: 'user_manual',
    sourceId: null,
    sourceRef: null,
    aiGenerated: false,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  } as KnowledgeItem;
}

function spec(id: string, modality: ReviewItemSpec['modality']): ReviewItemSpec {
  return {
    kind: 'review_recognition',
    modality,
    subjectId: id,
    prompt: 'q',
    options: null,
    expectedAnswer: null,
    hint: null,
  };
}

describe('M3 §D2: ladder ordering', () => {
  it('sorts questions recognition → recall → production without reshuffling peers', () => {
    const input = [
      spec('p1', 'production'),
      spec('r1', 'recognition'),
      spec('c1', 'recall'),
      spec('p2', 'production'),
      spec('c2', 'recall'),
      spec('r2', 'recognition'),
    ];
    const ordered = orderByLadder(input);
    expect(ordered.map((entry) => entry.modality)).toEqual([
      'recognition',
      'recognition',
      'recall',
      'recall',
      'production',
      'production',
    ]);
  });
});

describe('M3 §D2: wrong-answer requeue limit', () => {
  it('allows at most MAX_REQUEUE_ROUNDS extra appearances', () => {
    expect(canRequeue(1)).toBe(true); // first wrong -> requeue (appearance 2)
    expect(canRequeue(2)).toBe(true); // second wrong -> requeue (appearance 3)
    expect(canRequeue(3)).toBe(false); // third wrong -> stop, no infinite loop
    expect(MAX_REQUEUE_ROUNDS).toBe(2);
  });
});

describe('M3 §D2: dictation', () => {
  it('grades by case- and whitespace-insensitive fuzzy text match', () => {
    // Dictation reuses gradeTextAnswer (v0.3 §D2).
    expect(gradeTextAnswer('en', 'abandon', '  ABANDON  ').score).toBe(1);
    expect(gradeTextAnswer('en', 'abandon', 'Abandon').score).toBe(1);
    expect(gradeTextAnswer('en', 'abandon', 'abandn').verdict).toBe('near');
    expect(gradeTextAnswer('en', 'abandon', '').score).toBe(0);
  });

  it('generates a dictation card for a single word with an MCQ fallback', () => {
    const word = item({ id: 'w', text: 'abandon', meaning: '放弃' });
    const pool = [
      word,
      item({ id: 'd1', text: 'resilient', meaning: '有韧性' }),
      item({ id: 'd2', text: 'meticulous', meaning: '一丝不苟' }),
      item({ id: 'd3', text: 'leverage', meaning: '利用' }),
    ];
    const specs = buildReviewItems({
      entries: [{ item: word, state: null }],
      distractorPool: pool,
      limit: 1,
      seed: 1,
    });
    expect(specs[0]?.kind).toBe('review_dictation');
    expect(specs[0]?.modality).toBe('recognition');
    expect(specs[0]?.expectedAnswer).toBe('abandon');
    expect(specs[0]?.options).toHaveLength(4);
    expect(specs[0]?.options).toContain('放弃');
    expect(specs[0]?.hint).toBe('放弃');
  });

  it('keeps multi-word expressions on the four-choice recognition card', () => {
    const phrase = item({ id: 'p', text: 'figure out', meaning: '弄清楚' });
    const pool = [
      phrase,
      item({ id: 'd1', text: 'give up', meaning: '放弃' }),
      item({ id: 'd2', text: 'look after', meaning: '照顾' }),
      item({ id: 'd3', text: 'run into', meaning: '偶遇' }),
    ];
    const specs = buildReviewItems({
      entries: [{ item: phrase, state: null }],
      distractorPool: pool,
      limit: 1,
      seed: 1,
    });
    expect(specs[0]?.kind).toBe('review_recognition');
  });
});
