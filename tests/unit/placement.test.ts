import { describe, expect, it } from 'vitest';
import { detectGoalType } from '@/application/goals';
import {
  scoreToBand,
  selfReportLevel,
  synthesizePlacement,
} from '@/application/placement';

describe('placement synthesis (v0.4 §G1)', () => {
  it('uses the test when it agrees with the self-report', () => {
    const synthesis = synthesizePlacement(4.5, 4.0);
    expect(synthesis).toMatchObject({
      level: 4.5,
      confidence: 'medium',
      evidence: ['test', 'self_report'],
      conflict: false,
    });
  });

  it('flags a conflict when test and self-report differ by more than 1.5 bands', () => {
    const synthesis = synthesizePlacement(4.5, 6.5);
    expect(synthesis.conflict).toBe(true);
    expect(synthesis.level).toBeNull();
    expect(synthesis.testLevel).toBe(4.5);
    expect(synthesis.selfLevel).toBe(6.5);
  });

  it('does NOT flag a conflict when the difference is within 1.5 bands', () => {
    const synthesis = synthesizePlacement(4.5, 6.0);
    expect(synthesis.conflict).toBe(false);
    expect(synthesis.level).toBe(4.5);
  });

  it('falls back to the test when there is no self-report', () => {
    const synthesis = synthesizePlacement(5.0, null);
    expect(synthesis).toMatchObject({
      level: 5.0,
      confidence: 'medium',
      evidence: ['test'],
      conflict: false,
    });
  });

  it('uses the self-report with low confidence when there is no test', () => {
    const synthesis = synthesizePlacement(null, 4.0);
    expect(synthesis).toMatchObject({
      level: 4.0,
      confidence: 'low',
      evidence: ['self_report'],
      conflict: false,
    });
  });

  it('returns no level when neither signal exists', () => {
    const synthesis = synthesizePlacement(null, null);
    expect(synthesis.level).toBeNull();
    expect(synthesis.conflict).toBe(false);
  });
});

describe('placement helpers', () => {
  it('maps self-report options to bands and "unsure" to null', () => {
    expect(selfReportLevel('below_cet4')).toBe(3.5);
    expect(selfReportLevel('cet4')).toBe(4.0);
    expect(selfReportLevel('cet6')).toBe(6.0);
    expect(selfReportLevel('ielts5')).toBe(5.0);
    expect(selfReportLevel('ielts6')).toBe(6.0);
    expect(selfReportLevel('unsure')).toBeNull();
  });

  it('maps correctness to a 1–9 half-band estimate', () => {
    expect(scoreToBand(0)).toBe(1);
    expect(scoreToBand(0.5)).toBe(5);
    expect(scoreToBand(1)).toBe(9);
    expect(scoreToBand(1.5)).toBe(9); // clamps at 9
    expect(scoreToBand(-1)).toBe(1); // clamps at 1
  });

  it('detects IELTS goals from title/raw input (case-insensitive)', () => {
    expect(detectGoalType('雅思 7 分', '')).toBe('ielts');
    expect(detectGoalType('', 'IELTS 7')).toBe('ielts');
    expect(detectGoalType('提高商务英语口语', '')).toBe('general');
  });
});
