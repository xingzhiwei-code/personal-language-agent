import type { KnowledgeType, LanguageCode, SkillKind } from '@/domain/enums';

/**
 * Language-specific behaviour lives behind this capability interface so the
 * domain never contains `if (language === 'english')` branches (PRD §15.6).
 */
export interface LanguageCapability {
  readonly code: LanguageCode;
  /** Label in the UI language (Chinese for V0.1). */
  readonly label: string;
  readonly nativeLabel: string;
  /** Whether word boundaries can be detected by whitespace. */
  readonly whitespaceDelimited: boolean;
  /** Canonical form used for de-duplication. */
  normalize(text: string): string;
  /** Best-effort structural classification of a surface form. */
  classify(text: string): KnowledgeType;
  /** Splits a text into tokens (used by review generation, not grammar analysis). */
  tokenize(text: string): string[];
  /** Skills that matter most for this language by default. */
  readonly defaultSkills: readonly SkillKind[];
}
