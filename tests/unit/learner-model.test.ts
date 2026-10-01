import { describe, expect, it } from 'vitest';
import { computeConfidence } from '@/learner/confidence';
import { computeMastery } from '@/learner/mastery';
import { MASTERY_WEIGHT_SUM, LEARNER_PARAMS } from '@/learner/params';
import { isDue, qualityFromScore, scheduleNext } from '@/learner/srs';
import {
  applyEvidence,
  applyUserDeclaredMastery,
  computeTrend,
  createInitialState,
  revertEvidence,
} from '@/learner/state';
import { detectErrorPatterns, nextUsefulModality } from '@/learner/skills';
import type { Evidence } from '@/domain/entities';

const NOW = '2026-01-10T10:00:00.000Z';

function freshState() {
  return createInitialState({
    id: 'state-1',
    learnerId: 'learner-1',
    subjectType: 'knowledge_item',
    subjectId: 'item-1',
    nowIso: '2026-01-01T10:00:00.000Z',
  });
}

describe('mastery weights', () => {
  it('sums to exactly 1', () => {
    expect(MASTERY_WEIGHT_SUM).toBeCloseTo(1, 10);
  });
});

describe('initial state', () => {
  it('starts at zero mastery with floor confidence (no pretend knowledge)', () => {
    const state = freshState();
    expect(state.mastery).toBe(0);
    expect(state.confidence).toBeCloseTo(LEARNER_PARAMS.confidenceFloor, 5);
    expect(state.trend).toBe('unknown');
    expect(state.nextReviewAt).toBeNull();
  });
});

describe('single correct answer', () => {
  it('does not jump mastery to 100%', () => {
    const state = applyEvidence(
      freshState(),
      { modality: 'recognition', score: 1, occurredAt: NOW },
      NOW,
    );
    expect(state.mastery).toBeGreaterThan(0);
    expect(state.mastery).toBeLessThan(0.45);
    expect(state.exposureCount).toBe(1);
    expect(state.successfulAttempts).toBe(1);
  });

  it('keeps confidence clearly below certainty', () => {
    const state = applyEvidence(
      freshState(),
      { modality: 'recognition', score: 1, occurredAt: NOW },
      NOW,
    );
    expect(state.confidence).toBeLessThan(0.6);
  });
});

describe('exposure is not mastery', () => {
  it('many wrong answers keep mastery low despite high exposure', () => {
    let state = freshState();
    for (let i = 0; i < 10; i += 1) {
      const at = new Date(Date.parse(NOW) + i * 3_600_000).toISOString();
      state = applyEvidence(state, { modality: 'recognition', score: 0, occurredAt: at }, at);
    }
    expect(state.exposureCount).toBe(10);
    expect(state.mastery).toBeLessThan(0.25);
    expect(state.failedAttempts).toBe(10);
  });

  it('exposure alone contributes at most its 10% weight', () => {
    const breakdown = computeMastery(
      {
        recentEvidence: [],
        successfulAttempts: 0,
        failedAttempts: 0,
        stabilityDays: 0,
        retrievalStrength: 0,
        exposureCount: 1000,
        lastPracticedAt: null,
      },
      NOW,
    );
    expect(breakdown.exposureScore).toBeCloseTo(1, 3);
    expect(breakdown.mastery).toBeLessThanOrEqual(0.2);
  });
});

describe('sustained correct practice', () => {
  it('raises mastery well above a single success', () => {
    let state = freshState();
    const modalities = ['recognition', 'recall', 'production', 'recognition', 'recall'] as const;
    modalities.forEach((modality, index) => {
      const at = new Date(Date.parse('2026-01-01T10:00:00.000Z') + index * 86_400_000).toISOString();
      state = applyEvidence(state, { modality, score: 1, occurredAt: at }, at);
    });
    expect(state.mastery).toBeGreaterThan(0.6);
    expect(state.confidence).toBeGreaterThan(0.6);
    expect(state.repetitions).toBe(5);
  });
});

describe('confidence', () => {
  it('is independent from mastery and saturates for repeated same-type drills', () => {
    const repeated: Evidence[] = Array.from({ length: 8 }, (_, index) => ({
      modality: 'recognition' as const,
      score: 1,
      difficulty: null,
      occurredAt: new Date(Date.parse(NOW) - index * 3_600_000).toISOString(),
    }));
    const diverse: Evidence[] = [
      { modality: 'recognition', score: 1, difficulty: null, occurredAt: NOW },
      { modality: 'recall', score: 1, difficulty: null, occurredAt: NOW },
      { modality: 'production', score: 1, difficulty: null, occurredAt: NOW },
      { modality: 'listening', score: 1, difficulty: null, occurredAt: NOW },
    ];

    const repeatedConfidence = computeConfidence(repeated, NOW).confidence;
    const diverseConfidence = computeConfidence(diverse, NOW).confidence;

    expect(diverseConfidence).toBeGreaterThan(repeatedConfidence);
    expect(computeConfidence(repeated.slice(0, 4), NOW).confidence).toBeGreaterThan(0);
    // 8 identical drills add almost nothing over 4.
    expect(repeatedConfidence - computeConfidence(repeated.slice(0, 4), NOW).confidence).toBeLessThan(
      0.1,
    );
  });

  it('never claims confidence without evidence', () => {
    expect(computeConfidence([], NOW).confidence).toBeCloseTo(LEARNER_PARAMS.confidenceFloor, 5);
  });
});

describe('srs', () => {
  it('maps scores to qualities deterministically', () => {
    expect(qualityFromScore(1)).toBe(5);
    expect(qualityFromScore(0.8)).toBe(4);
    expect(qualityFromScore(0.6)).toBe(3);
    expect(qualityFromScore(0.4)).toBe(2);
    expect(qualityFromScore(0)).toBe(0);
  });

  it('gives a first success a short interval, not "stable"', () => {
    const result = scheduleNext(
      { easeFactor: 2.5, intervalDays: 0, repetitions: 0, retrievalStrength: 0 },
      1,
      NOW,
    );
    expect(result.intervalDays).toBe(LEARNER_PARAMS.firstIntervalDays);
    expect(result.repetitions).toBe(1);
    expect(isDue(result.nextReviewAt, NOW)).toBe(false);
  });

  it('resets on failure and lowers ease', () => {
    const result = scheduleNext(
      { easeFactor: 2.5, intervalDays: 10, repetitions: 4, retrievalStrength: 0.9 },
      0,
      NOW,
    );
    expect(result.repetitions).toBe(0);
    expect(result.easeFactor).toBeLessThan(2.5);
    expect(result.intervalDays).toBeLessThanOrEqual(1);
  });

  it('grows intervals for repeated success', () => {
    let srs = { easeFactor: 2.5, intervalDays: 0, repetitions: 0, retrievalStrength: 0 };
    const intervals: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = scheduleNext(srs, 1, NOW);
      intervals.push(next.intervalDays);
      srs = {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        retrievalStrength: next.retrievalStrength,
      };
    }
    expect(intervals[0]).toBeLessThan(intervals[1]!);
    expect(intervals[1]).toBeLessThan(intervals[2]!);
  });
});

describe('user declared mastery', () => {
  it('raises mastery but caps confidence (self-report is weaker evidence)', () => {
    const state = applyUserDeclaredMastery(freshState(), NOW);
    expect(state.userDeclaredMastered).toBe(true);
    expect(state.mastery).toBeGreaterThanOrEqual(LEARNER_PARAMS.userDeclaredMasteryFloor);
    expect(state.confidence).toBeLessThanOrEqual(LEARNER_PARAMS.userDeclaredConfidenceCap);
    expect(state.nextReviewAt).not.toBeNull();
  });
});

describe('correction / revert', () => {
  it('removes the effect of a mis-graded answer', () => {
    const base = freshState();
    const wrong = applyEvidence(
      base,
      { modality: 'recall', score: 0, occurredAt: NOW },
      NOW,
    );
    const reverted = revertEvidence(wrong, { modality: 'recall', occurredAt: NOW }, NOW);
    expect(reverted.exposureCount).toBe(0);
    expect(reverted.failedAttempts).toBe(0);
    expect(reverted.recentEvidence).toHaveLength(0);
  });
});

describe('trend', () => {
  it('is unknown with too little evidence and improving when scores rise', () => {
    expect(computeTrend([])).toBe('unknown');
    const evidence: Evidence[] = [
      { modality: 'recall', score: 0, difficulty: null, occurredAt: '2026-01-01T00:00:00.000Z' },
      { modality: 'recall', score: 0, difficulty: null, occurredAt: '2026-01-02T00:00:00.000Z' },
      { modality: 'recall', score: 1, difficulty: null, occurredAt: '2026-01-03T00:00:00.000Z' },
      { modality: 'recall', score: 1, difficulty: null, occurredAt: '2026-01-04T00:00:00.000Z' },
    ];
    expect(computeTrend(evidence)).toBe('improving');
  });
});

describe('error patterns and modality selection', () => {
  it('flags the weak modality and prefers untested modalities next', () => {
    let state = freshState();
    state = applyEvidence(state, { modality: 'recognition', score: 1, occurredAt: NOW }, NOW);
    expect(nextUsefulModality(state)).toBe('recall');

    state = applyEvidence(state, { modality: 'recall', score: 0, occurredAt: NOW }, NOW);
    state = applyEvidence(state, { modality: 'recall', score: 0, occurredAt: NOW }, NOW);
    const patterns = detectErrorPatterns(state);
    expect(patterns.some((pattern) => pattern.modality === 'recall')).toBe(true);
  });
});
