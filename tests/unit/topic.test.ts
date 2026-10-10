import { describe, expect, it } from 'vitest';
import { topicForLearningDay } from '@/application/topic';

describe('topic rotation (v0.4 §G3)', () => {
  const seq = ['daily_life', 'education', 'work'];

  it('starts at the first topic on the first learning day', () => {
    expect(topicForLearningDay(seq, 0)).toBe('daily_life');
  });

  it('advances once per completed learning day', () => {
    expect(topicForLearningDay(seq, 1)).toBe('education');
    expect(topicForLearningDay(seq, 2)).toBe('work');
  });

  it('wraps around after the last topic', () => {
    expect(topicForLearningDay(seq, 3)).toBe('daily_life');
    expect(topicForLearningDay(seq, 5)).toBe('work');
  });

  it('never resets on skipped days (断更续接)', () => {
    // A big completed-day count just keeps advancing, it does not reset to 0.
    expect(topicForLearningDay(seq, 10)).toBe('education');
  });

  it('returns null for an empty topic sequence', () => {
    expect(topicForLearningDay([], 0)).toBeNull();
    expect(topicForLearningDay([], 3)).toBeNull();
  });
});
