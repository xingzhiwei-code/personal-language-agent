import { describe, expect, it } from 'vitest';
import { computeCalibrationSuggestion, estimateBand } from '@/application/auto-calibration';

describe('estimateBand', () => {
  it('returns null with no evidence', () => {
    expect(
      estimateBand({ masteryValues: [], assessmentScores: [], learningDayCount: 0 }),
    ).toBeNull();
  });

  it('maps mastered-ratio + accuracy to a band (deterministic)', () => {
    const estimate = estimateBand({
      masteryValues: [0.9, 0.9, 0.9, 0.9], // 100% mastered
      assessmentScores: [0.9, 0.9, 0.9, 0.9], // 90% accuracy
      learningDayCount: 14,
    });
    expect(estimate).not.toBeNull();
    // composite = (1.0 + 0.9) / 2 = 0.95 → scoreToBand = roundHalf(1 + 7.6) = 8.5
    expect(estimate!.value).toBe(8.5);
  });
});

describe('computeCalibrationSuggestion', () => {
  it('does not trigger below the 0.5 band threshold', () => {
    expect(computeCalibrationSuggestion(4.9, 4.5)).toBeNull(); // delta 0.4
  });

  it('triggers at exactly the 0.5 band threshold (boundary)', () => {
    const suggestion = computeCalibrationSuggestion(5.0, 4.5); // delta 0.5
    expect(suggestion).not.toBeNull();
    expect(suggestion!.suggestedValue).toBe(5.0);
  });

  it('caps a single upward step at 1.0 band', () => {
    const suggestion = computeCalibrationSuggestion(7.0, 4.5); // delta 2.5
    expect(suggestion!.suggestedValue).toBe(5.5);
    expect(suggestion!.delta).toBe(1.0);
  });

  it('caps a single downward step at -1.0 band', () => {
    const suggestion = computeCalibrationSuggestion(2.0, 4.5); // delta -2.5
    expect(suggestion!.suggestedValue).toBe(3.5);
    expect(suggestion!.delta).toBe(-1.0);
  });
});
