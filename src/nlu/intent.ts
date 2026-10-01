import type { Intent } from '@/domain/enums';
import { detectCommands, hasCommand, type UserCommand } from './commands';

export interface IntentResult {
  intent: Intent;
  confidence: number;
  /** Which rule produced the result — surfaced in debug/telemetry, not to users. */
  matched: string | null;
  commands: UserCommand[];
}

const RULES: { intent: Intent; weight: number; patterns: RegExp[] }[] = [
  {
    intent: 'exploration',
    weight: 0.9,
    patterns: [
      /什么意思/,
      /怎么(说|用|读)/,
      /有什么区别/,
      /区别是/,
      /为什么/,
      /可以解释/,
      /解释一下/,
      /what\s+(does|do|is|are)\b/i,
      /\bmean(s|ing)?\b/i,
      /how\s+(do|would)\s+(you|i)\s+say/i,
      /difference\s+between/i,
      /\bexplain\b/i,
      /\?$/,
      /？$/,
    ],
  },
  {
    intent: 'conversation',
    weight: 0.95,
    patterns: [
      /聊天/,
      /聊聊/,
      /说说话/,
      /对话/,
      /\bchat\b/i,
      /\btalk\b/i,
      /conversation/i,
    ],
  },
  {
    intent: 'practice',
    weight: 0.9,
    patterns: [
      /练(习|一下|口语|听力|语法)/,
      /做(题|练习)/,
      /复习/,
      /背单词/,
      /\bpractice\b/i,
      /\bdrill\b/i,
      /\breview\b/i,
      /\bexercise\b/i,
      /\bquiz\b/i,
    ],
  },
  {
    intent: 'learning',
    weight: 0.8,
    patterns: [
      /我想(提高|学|提升)/,
      /想学/,
      /教我/,
      /学习(目标|计划)?/,
      /\bi\s+want\s+to\s+(learn|improve)\b/i,
      /\bteach\s+me\b/i,
      /\bstudy\b/i,
      /\bimprove\b/i,
    ],
  },
  {
    intent: 'support',
    weight: 0.85,
    patterns: [
      /设置/,
      /导出(数据)?/,
      /删除(数据)?/,
      /怎么用这个(应用|产品|app)/,
      /用不了/,
      /报错/,
      /\bsettings?\b/i,
      /\bexport\b/i,
      /delete\s+my\s+data/i,
      /not\s+working/i,
      /\bbug\b/i,
    ],
  },
];

/**
 * Deterministic intent classification. The LLM is only consulted when this
 * returns `unknown` *and* the caller actually needs an interpretation
 * (AI Router policy, PRD §10.5).
 */
export function detectIntent(input: string): IntentResult {
  const text = input.trim();
  const commands = detectCommands(text);

  if (!text) {
    return { intent: 'unknown', confidence: 0, matched: null, commands };
  }

  // Explicit control commands outrank everything else.
  if (hasCommand(commands, 'chat_only')) {
    return { intent: 'conversation', confidence: 1, matched: 'command:chat_only', commands };
  }
  if (hasCommand(commands, 'review_now')) {
    return { intent: 'practice', confidence: 1, matched: 'command:review_now', commands };
  }

  let best: IntentResult = { intent: 'unknown', confidence: 0, matched: null, commands };
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (match && rule.weight > best.confidence) {
        best = {
          intent: rule.intent,
          confidence: rule.weight,
          matched: `${rule.intent}:${pattern.source}`,
          commands,
        };
        break;
      }
    }
  }

  return best;
}
