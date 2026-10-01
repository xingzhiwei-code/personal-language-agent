import type { KnowledgeType, LanguageCode } from '@/domain/enums';
import { english } from './english';
import type { LanguageCapability } from './types';

/**
 * Generic fallback capability. Enough to store and review knowledge in any
 * language without pretending we have real analysis for it.
 */
const generic = (code: LanguageCode, label: string, whitespaceDelimited: boolean): LanguageCapability => ({
  code,
  label,
  nativeLabel: label,
  whitespaceDelimited,
  defaultSkills: ['vocabulary', 'listening', 'speaking', 'reading'],
  normalize: (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' '),
  classify: (text: string): KnowledgeType => {
    const trimmed = text.trim();
    if (!trimmed) return 'word';
    if (whitespaceDelimited) {
      const words = trimmed.split(/\s+/);
      if (words.length === 1) return 'word';
      if (words.length > 8) return 'sentence';
      return 'phrase';
    }
    if (trimmed.length <= 3) return 'word';
    if (trimmed.length > 24) return 'sentence';
    return 'phrase';
  },
  tokenize: (text: string) =>
    whitespaceDelimited
      ? text.toLowerCase().split(/\s+/).filter(Boolean)
      : Array.from(text.trim()).filter((char) => char.trim().length > 0),
});

const CAPABILITIES: Record<string, LanguageCapability> = {
  en: english,
  ja: generic('ja', '日语', false),
  ko: generic('ko', '韩语', false),
  fr: generic('fr', '法语', true),
  de: generic('de', '德语', true),
  es: generic('es', '西班牙语', true),
  zh: generic('zh', '中文', false),
};

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const SUPPORTED_LANGUAGES: readonly { code: LanguageCode; label: string; full: boolean }[] =
  [
    { code: 'en', label: '英语', full: true },
    { code: 'ja', label: '日语', full: false },
    { code: 'ko', label: '韩语', full: false },
    { code: 'fr', label: '法语', full: false },
    { code: 'de', label: '德语', full: false },
    { code: 'es', label: '西班牙语', full: false },
  ];

export function getLanguageCapability(code: string): LanguageCapability {
  const normalized = code.toLowerCase().split('-')[0] ?? DEFAULT_LANGUAGE;
  return CAPABILITIES[normalized] ?? generic(normalized, normalized.toUpperCase(), true);
}

export function languageLabel(code: string): string {
  return getLanguageCapability(code).label;
}

export function normalizeKnowledgeText(languageCode: string, text: string): string {
  return getLanguageCapability(languageCode).normalize(text);
}

export function classifyKnowledgeText(languageCode: string, text: string): KnowledgeType {
  return getLanguageCapability(languageCode).classify(text);
}
