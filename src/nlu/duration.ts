const ZH_NUMERALS: Record<string, number> = {
  零: 0,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十五: 15,
  二十: 20,
  三十: 30,
  半: 0.5,
};

function zhNumber(raw: string): number | null {
  if (ZH_NUMERALS[raw] !== undefined) return ZH_NUMERALS[raw];
  // "十五" / "二十五" style composites.
  const match = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(raw);
  if (match) {
    const tens = match[1] ? (ZH_NUMERALS[match[1]] ?? 1) : 1;
    const ones = match[2] ? (ZH_NUMERALS[match[2]] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return null;
}

/**
 * Deterministic duration extraction — no LLM required for "我只有 3 分钟".
 * Returns whole minutes, or null when the text contains no duration.
 */
export function parseAvailableMinutes(input: string): number | null {
  const text = input.toLowerCase();

  if (/半\s*小时|half an hour|half-hour/.test(text)) return 30;
  if (/一刻钟|quarter of an hour/.test(text)) return 15;

  const patterns: { regex: RegExp; unit: 'minute' | 'hour' }[] = [
    { regex: /(\d+(?:\.\d+)?)\s*(?:分钟|分|mins?\b|minutes?\b|m\b)/, unit: 'minute' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:小时|个小时|hours?\b|hrs?\b|h\b)/, unit: 'hour' },
  ];

  for (const { regex, unit } of patterns) {
    const match = regex.exec(text);
    if (match?.[1]) {
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value) && value > 0) {
        const minutes = unit === 'hour' ? value * 60 : value;
        return clampMinutes(minutes);
      }
    }
  }

  const zhPatterns: { regex: RegExp; unit: 'minute' | 'hour' }[] = [
    { regex: /([零一两二三四五六七八九十]+)\s*分钟/, unit: 'minute' },
    { regex: /([零一两二三四五六七八九十半]+)\s*(?:个)?小时/, unit: 'hour' },
  ];

  for (const { regex, unit } of zhPatterns) {
    const match = regex.exec(text);
    if (match?.[1]) {
      const value = zhNumber(match[1]);
      if (value !== null && value > 0) {
        return clampMinutes(unit === 'hour' ? value * 60 : value);
      }
    }
  }

  return null;
}

function clampMinutes(minutes: number): number {
  const rounded = Math.round(minutes);
  if (rounded < 1) return 1;
  if (rounded > 240) return 240;
  return rounded;
}
