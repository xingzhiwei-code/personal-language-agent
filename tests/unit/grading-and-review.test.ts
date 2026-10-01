import { describe, expect, it } from 'vitest';
import {
  gradeChoice,
  gradeTextAnswer,
  levenshtein,
  scoreFromSelfRating,
} from '@/assessment/grading';
import { buildReviewItems } from '@/assessment/review-items';
import { canTransition, isResumable, isTerminal } from '@/domain/session-rules';
import type { KnowledgeItem, LearnerState } from '@/domain/entities';
import { createInitialState, applyEvidence } from '@/learner/state';
import { classifyKnowledgeText, normalizeKnowledgeText } from '@/language/registry';

const NOW = '2026-01-10T10:00:00.000Z';

function item(partial: Partial<KnowledgeItem> & { id: string; text: string }): KnowledgeItem {
  return {
    learnerId: 'learner-1',
    languageCode: 'en',
    type: 'phrase',
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

function state(id: string): LearnerState {
  return createInitialState({
    id: `state-${id}`,
    learnerId: 'learner-1',
    subjectType: 'knowledge_item',
    subjectId: id,
    nowIso: NOW,
  });
}

describe('deterministic grading', () => {
  it('accepts exact answers and tolerates small typos', () => {
    expect(gradeTextAnswer('en', 'figure out', 'figure out').score).toBe(1);
    expect(gradeTextAnswer('en', 'figure out', 'Figure Out.').score).toBe(1);
    expect(gradeTextAnswer('en', 'figure out', 'figure ou').verdict).toBe('near');
    expect(gradeTextAnswer('en', 'figure out', 'figure ou').score).toBe(0.7);
    expect(gradeTextAnswer('en', 'figure out', 'give up').score).toBe(0);
    expect(gradeTextAnswer('en', 'figure out', '').score).toBe(0);
  });

  it('grades multiple choice strictly', () => {
    expect(gradeChoice('弄清楚', '弄清楚').score).toBe(1);
    expect(gradeChoice('弄清楚', '放弃').score).toBe(0);
  });

  it('maps self ratings to honest partial credit', () => {
    expect(scoreFromSelfRating('known')).toBe(1);
    expect(scoreFromSelfRating('unsure')).toBe(0.5);
    expect(scoreFromSelfRating('forgot')).toBe(0);
  });

  it('computes edit distance', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('knowledge classification', () => {
  it('keeps "figure" and "figure out" as different types', () => {
    expect(classifyKnowledgeText('en', 'figure')).toBe('word');
    expect(classifyKnowledgeText('en', 'figure out')).toBe('phrase');
    expect(classifyKnowledgeText('en', 'It took me a while to figure it out.')).toBe('sentence');
    expect(classifyKnowledgeText('en', 'be about to ___')).toBe('pattern');
  });
});

describe('review item generation', () => {
  const pool = [
    item({ id: 'a', text: 'figure out', meaning: '弄清楚' }),
    item({ id: 'b', text: 'give up', meaning: '放弃' }),
    item({ id: 'c', text: 'look after', meaning: '照顾' }),
    item({ id: 'd', text: 'run into', meaning: '偶遇' }),
  ];

  it('creates a recognition question with three distractors', () => {
    const specs = buildReviewItems({
      entries: [{ item: pool[0]!, state: state('a') }],
      distractorPool: pool,
      limit: 1,
      seed: 42,
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]?.modality).toBe('recognition');
    expect(specs[0]?.options).toHaveLength(4);
    expect(specs[0]?.options).toContain('弄清楚');
    expect(specs[0]?.expectedAnswer).toBe('弄清楚');
  });

  it('escalates to recall once recognition is established', () => {
    let learnerState = state('a');
    learnerState = applyEvidence(
      learnerState,
      { modality: 'recognition', score: 1, occurredAt: NOW },
      NOW,
    );
    const specs = buildReviewItems({
      entries: [{ item: pool[0]!, state: learnerState }],
      distractorPool: pool,
      limit: 1,
      seed: 42,
    });
    expect(specs[0]?.modality).toBe('recall');
    expect(specs[0]?.expectedAnswer).toBe('figure out');
  });

  it('builds a cloze question from a real example sentence', () => {
    const withExample = item({
      id: 'e',
      text: 'figure out',
      meaning: '弄清楚',
      examples: [{ text: 'I need to figure out the schedule.', origin: 'authentic' }],
    });
    let learnerState = state('e');
    learnerState = applyEvidence(
      learnerState,
      { modality: 'recognition', score: 1, occurredAt: NOW },
      NOW,
    );
    learnerState = applyEvidence(
      learnerState,
      { modality: 'recall', score: 1, occurredAt: NOW },
      NOW,
    );
    const specs = buildReviewItems({
      entries: [{ item: withExample, state: learnerState }],
      distractorPool: pool,
      limit: 1,
      seed: 7,
    });
    expect(specs[0]?.modality).toBe('production');
    expect(specs[0]?.prompt).toContain('______');
  });

  it('falls back to an honest self-check when there is no meaning or example', () => {
    const bare = item({ id: 'f', text: 'hold on' });
    const specs = buildReviewItems({
      entries: [{ item: bare, state: state('f') }],
      distractorPool: [bare],
      limit: 1,
    });
    expect(specs[0]?.expectedAnswer).toBeNull();
    expect(specs[0]?.hint).toContain('释义');
  });

  it('is reproducible for a given seed', () => {
    const first = buildReviewItems({ entries: pool.map((entry) => ({ item: entry, state: state(entry.id) })), distractorPool: pool, limit: 4, seed: 99 });
    const second = buildReviewItems({ entries: pool.map((entry) => ({ item: entry, state: state(entry.id) })), distractorPool: pool, limit: 4, seed: 99 });
    expect(first).toEqual(second);
  });
});

describe('session state machine', () => {
  it('allows the legitimate transitions only', () => {
    expect(canTransition('created', 'active')).toBe(true);
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
    expect(canTransition('active', 'completed')).toBe(true);
    expect(canTransition('completed', 'active')).toBe(false);
    expect(canTransition('abandoned', 'completed')).toBe(false);
    // Re-submitting the same action is idempotent, not an error.
    expect(canTransition('paused', 'paused')).toBe(true);
  });

  it('classifies terminal and resumable states', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('abandoned')).toBe(true);
    expect(isResumable('paused')).toBe(true);
    expect(isResumable('completed')).toBe(false);
  });
});
