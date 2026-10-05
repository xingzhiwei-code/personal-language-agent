import { describe, expect, it } from 'vitest';
import { computeStreak, previousDayKey } from '@/application/streak';

describe('M4 §D3: study streak calculation', () => {
  it('counts consecutive completed-session days ending today', () => {
    expect(
      computeStreak(['2026-10-05', '2026-10-04', '2026-10-03', '2026-10-01'], '2026-10-05'),
    ).toBe(3);
  });

  it('restarts at 1 after a gap (断一天后重新从 1 计)', () => {
    expect(computeStreak(['2026-10-05', '2026-10-03'], '2026-10-05')).toBe(1);
  });

  it('is 0 when today has no completed session', () => {
    expect(computeStreak(['2026-10-04', '2026-10-03'], '2026-10-05')).toBe(0);
  });

  it('is 1 on the very first completed day', () => {
    expect(computeStreak(['2026-10-05'], '2026-10-05')).toBe(1);
  });

  it('moves to the previous day across month boundaries', () => {
    expect(previousDayKey('2026-10-01')).toBe('2026-09-30');
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
  });
});
