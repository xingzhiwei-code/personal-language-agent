import type {
  ActivityType,
  ContentOrigin,
  KnowledgeRelationType,
  KnowledgeStatus,
  KnowledgeType,
  Modality,
  SessionStatus,
  SkillKind,
  SourceType,
  Trend,
  WordRelationType,
} from '@/domain/enums';

/** Chinese UI labels for domain enums. Shared by server and client components. */

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  quick_review: '快速复习',
  vocabulary_recall: '词汇回忆',
  reading: '阅读练习',
  listening: '听力练习',
  conversation: '自由对话',
  grammar_practice: '语法练习',
  writing: '写作练习',
  pronunciation: '发音练习',
  placement: '水平摸底',
};

export const SKILL_LABELS: Record<SkillKind, string> = {
  speaking: '口语',
  listening: '听力',
  reading: '阅读',
  writing: '写作',
  vocabulary: '词汇',
  grammar: '语法',
  pronunciation: '发音',
  interaction: '互动交流',
};

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeType, string> = {
  word: '单词',
  phrase: '短语',
  chunk: '词块',
  sentence: '句子',
  pattern: '句型',
  grammar: '语法',
  pronunciation: '发音',
  expression: '表达',
  concept: '概念',
};

export const RELATION_LABELS: Record<KnowledgeRelationType, string> = {
  related: '相关',
  derived_from: '派生自',
  variant_of: '变体',
  contrasts_with: '易混淆',
  commonly_used_with: '常一起用',
  part_of: '属于',
  example_of: '例子',
};

export const ORIGIN_LABELS: Record<ContentOrigin, string> = {
  authentic: '真实素材',
  user: '我记录的',
  ai_generated: 'AI 生成',
  system_generated: '系统生成',
};

export const SOURCE_LABELS: Record<SourceType, string> = {
  real_conversation: '真实对话',
  chat_session: '应用内对话',
  youtube: 'YouTube',
  article: '文章',
  pdf: 'PDF',
  web: '网页',
  dictionary: '词典',
  corpus: '语料库',
  user_import: '我导入的',
  user_manual: '我手动添加',
  ai_generated: 'AI 生成',
  system_generated: '系统生成',
};

export const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  new: '词库池',
  active: '学习中',
  user_mastered: '我已掌握',
  irrelevant: '不相关',
  archived: '已归档',
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  created: '已创建',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  abandoned: '已退出',
};

export const MODALITY_LABELS: Record<Modality, string> = {
  recognition: '识别',
  recall: '回忆',
  production: '产出',
  listening: '听辨',
  transfer: '真实迁移',
};

export const TREND_LABELS: Record<Trend, string> = {
  improving: '在进步',
  stable: '稳定',
  declining: '有下降',
  unknown: '数据还不够',
};

export const WORD_RELATION_LABELS: Record<WordRelationType, string> = {
  topic: '话题',
  synonym: '同义',
  antonym: '反义',
  word_family: '同族',
};

export const FACTOR_LABELS: Record<string, string> = {
  learningValue: '学习价值',
  urgency: '紧急度',
  goalAlignment: '目标契合',
  contextFit: '情境契合',
  durationFit: '时长契合',
  preferenceFit: '偏好契合',
  novelty: '新鲜度',
  repetitionPenalty: '重复惩罚',
  friction: '操作成本',
};
