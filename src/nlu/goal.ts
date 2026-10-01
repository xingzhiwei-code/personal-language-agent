import type { LanguageCode, SkillKind } from '@/domain/enums';
import { DEFAULT_LANGUAGE, getLanguageCapability } from '@/language/registry';
import { parseAvailableMinutes } from './duration';

export interface ParsedGoal {
  languageCode: LanguageCode;
  languageConfidence: number;
  title: string;
  skills: { skill: SkillKind; importance: number }[];
  scenarios: string[];
  availableMinutes: number | null;
}

const LANGUAGE_HINTS: { code: LanguageCode; patterns: RegExp[] }[] = [
  { code: 'en', patterns: [/英语|英文|美语|english/i] },
  { code: 'ja', patterns: [/日语|日文|japanese/i] },
  { code: 'ko', patterns: [/韩语|韩文|korean/i] },
  { code: 'fr', patterns: [/法语|法文|french/i] },
  { code: 'de', patterns: [/德语|德文|german/i] },
  { code: 'es', patterns: [/西班牙语|spanish/i] },
];

const SKILL_HINTS: { skill: SkillKind; patterns: RegExp[] }[] = [
  { skill: 'speaking', patterns: [/口语|说|口头|表达|speak|speaking|oral/i] },
  { skill: 'listening', patterns: [/听力|听懂|听|listen|listening/i] },
  { skill: 'reading', patterns: [/阅读|读|看文章|read|reading/i] },
  { skill: 'writing', patterns: [/写作|写|邮件|write|writing|email/i] },
  { skill: 'vocabulary', patterns: [/单词|词汇|生词|vocab|vocabulary|words?/i] },
  { skill: 'grammar', patterns: [/语法|时态|grammar|tense/i] },
  { skill: 'pronunciation', patterns: [/发音|口音|pronunc|accent/i] },
  { skill: 'interaction', patterns: [/交流|沟通|社交|面试|会议|interview|meeting|conversation/i] },
];

const SCENARIO_HINTS: { label: string; patterns: RegExp[] }[] = [
  { label: '工作会议', patterns: [/会议|meeting|standup/i] },
  { label: '面试', patterns: [/面试|interview/i] },
  { label: '旅行', patterns: [/旅行|旅游|travel|trip/i] },
  { label: '日常交流', patterns: [/日常|生活|daily|everyday/i] },
  { label: '商务邮件', patterns: [/邮件|business email|email/i] },
  { label: '考试', patterns: [/考试|雅思|托福|ielts|toefl|exam/i] },
  { label: '技术交流', patterns: [/技术|工程|开发|tech|engineering/i] },
  { label: '留学', patterns: [/留学|study abroad/i] },
];

/**
 * Turns a free-text goal such as "我想提高英语口语" into a structured goal.
 * Fully rule-based: creating a goal must never depend on an AI key being set.
 */
export function parseGoalInput(input: string): ParsedGoal {
  const text = input.trim();

  let languageCode: LanguageCode = DEFAULT_LANGUAGE;
  let languageConfidence = 0.3;
  for (const hint of LANGUAGE_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(text))) {
      languageCode = hint.code;
      languageConfidence = 0.95;
      break;
    }
  }

  const matchedSkills: SkillKind[] = [];
  for (const hint of SKILL_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(text))) {
      matchedSkills.push(hint.skill);
    }
  }

  const capability = getLanguageCapability(languageCode);
  const skillList: SkillKind[] =
    matchedSkills.length > 0 ? matchedSkills : [...capability.defaultSkills];

  // Explicitly mentioned skills get high importance; implied supporting skills
  // get a lower weight so the scheduler still has something to work with.
  const skills = skillList.map((skill, index) => ({
    skill,
    importance:
      matchedSkills.length > 0
        ? index === 0
          ? 1
          : Math.max(0.5, 1 - index * 0.15)
        : Math.max(0.35, 0.7 - index * 0.06),
  }));

  // Vocabulary always carries some weight: it is the substrate of every skill.
  if (!skills.some((entry) => entry.skill === 'vocabulary')) {
    skills.push({ skill: 'vocabulary', importance: 0.6 });
  }

  const scenarios = SCENARIO_HINTS.filter((hint) =>
    hint.patterns.some((pattern) => pattern.test(text)),
  ).map((hint) => hint.label);

  return {
    languageCode,
    languageConfidence,
    title: buildTitle(text, languageCode, matchedSkills),
    skills,
    scenarios,
    availableMinutes: parseAvailableMinutes(text),
  };
}

const SKILL_LABELS: Record<SkillKind, string> = {
  speaking: '口语',
  listening: '听力',
  reading: '阅读',
  writing: '写作',
  vocabulary: '词汇',
  grammar: '语法',
  pronunciation: '发音',
  interaction: '交流',
};

function buildTitle(raw: string, languageCode: LanguageCode, skills: SkillKind[]): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 0 && cleaned.length <= 40) return cleaned;
  const label = getLanguageCapability(languageCode).label;
  const skillLabel = skills[0] ? SKILL_LABELS[skills[0]] : '综合能力';
  return `提高${label}${skillLabel}`;
}

export function skillLabel(skill: SkillKind): string {
  return SKILL_LABELS[skill];
}
