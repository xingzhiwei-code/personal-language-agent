import { getLanguageCapability } from '@/language/registry';

/**
 * Deterministic grading. Reviewing must work with no AI configured (PRD §F-05),
 * so answers are compared with normalisation + edit distance, never an LLM.
 */

export interface GradeResult {
  score: number;
  /** Exact / near / wrong — used for user-facing feedback wording. */
  verdict: 'exact' | 'near' | 'wrong';
  normalizedExpected: string;
  normalizedActual: string;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export function gradeTextAnswer(
  languageCode: string,
  expected: string,
  actual: string,
): GradeResult {
  const capability = getLanguageCapability(languageCode);
  const normalizedExpected = capability
    .normalize(expected)
    .replace(/[.,!?;:"']/g, '')
    .trim();
  const normalizedActual = capability
    .normalize(actual)
    .replace(/[.,!?;:"']/g, '')
    .trim();

  if (normalizedActual.length === 0) {
    return { score: 0, verdict: 'wrong', normalizedExpected, normalizedActual };
  }
  if (normalizedExpected === normalizedActual) {
    return { score: 1, verdict: 'exact', normalizedExpected, normalizedActual };
  }

  const distance = levenshtein(normalizedExpected, normalizedActual);
  const tolerance = Math.max(1, Math.floor(normalizedExpected.length * 0.2));
  if (distance <= tolerance) {
    // Typos and minor inflection differences still show retrieval happened.
    return { score: 0.7, verdict: 'near', normalizedExpected, normalizedActual };
  }
  return { score: 0, verdict: 'wrong', normalizedExpected, normalizedActual };
}

export function gradeChoice(expected: string, actual: string): GradeResult {
  const normalizedExpected = expected.trim();
  const normalizedActual = actual.trim();
  const correct = normalizedExpected === normalizedActual;
  return {
    score: correct ? 1 : 0,
    verdict: correct ? 'exact' : 'wrong',
    normalizedExpected,
    normalizedActual,
  };
}

export type SelfRating = 'forgot' | 'unsure' | 'known';

/** Self-report is honest evidence too — just weaker than a measured answer. */
export function scoreFromSelfRating(rating: SelfRating): number {
  switch (rating) {
    case 'known':
      return 1;
    case 'unsure':
      return 0.5;
    default:
      return 0;
  }
}
