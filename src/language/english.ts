import type { KnowledgeType } from '@/domain/enums';
import type { LanguageCapability } from './types';

const SENTENCE_END = /[.!?]\s*$/;

/** English is the only fully implemented capability in V0.1. */
export const english: LanguageCapability = {
  code: 'en',
  label: '英语',
  nativeLabel: 'English',
  whitespaceDelimited: true,
  defaultSkills: ['speaking', 'listening', 'vocabulary', 'grammar', 'reading', 'writing'],

  normalize(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, ' ');
  },

  classify(text: string): KnowledgeType {
    const trimmed = text.trim();
    if (!trimmed) return 'word';
    const words = trimmed.split(/\s+/);
    if (words.length === 1) return 'word';
    if (SENTENCE_END.test(trimmed) || words.length > 8) return 'sentence';
    // Templates such as "be about to ___" are patterns, not fixed phrases.
    if (/[_…]|\.\.\.|\bsth\b|\bsb\b/i.test(trimmed)) return 'pattern';
    if (words.length <= 3) return 'phrase';
    return 'chunk';
  },

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9''-]+/)
      .filter((token) => token.length > 0);
  },
};
