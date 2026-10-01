import { parseAvailableMinutes } from './duration';

/**
 * Explicit user control commands (PRD §5.1). These are matched
 * deterministically: the user must never need an LLM round-trip to say
 * "don't correct me".
 */
export type UserCommandKind =
  | 'chat_only'
  | 'disable_correction'
  | 'enable_correction'
  | 'time_limit'
  | 'skip'
  | 'pause'
  | 'end'
  | 'resume'
  | 'already_known'
  | 'reject_recommendation'
  | 'save_this'
  | 'review_now';

export interface UserCommand {
  kind: UserCommandKind;
  /** e.g. minutes for `time_limit`. */
  value?: number;
  matched: string;
}

interface Rule {
  kind: UserCommandKind;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    kind: 'disable_correction',
    patterns: [
      /不要(再)?(纠正|改正|纠错)/,
      /别(纠正|改正|纠错)/,
      /先?不用(纠正|纠错)/,
      /关闭纠错/,
      /(don'?t|do not|stop)\s+(correct|correcting|fix)/i,
      /no\s+correction/i,
    ],
  },
  {
    kind: 'enable_correction',
    patterns: [
      /(可以|请)?(帮我)?(开启|打开)?纠(正|错)(吧|我)?/,
      /开启纠错/,
      /(please\s+)?correct\s+(me|my)/i,
      /turn on correction/i,
    ],
  },
  {
    kind: 'chat_only',
    patterns: [
      /今天?只想(聊天|聊聊|说说话)/,
      /(就|只)想(聊天|聊聊)/,
      /随便聊/,
      /只聊天/,
      /just\s+(want\s+to\s+)?chat/i,
      /only\s+chat/i,
      /let'?s\s+just\s+talk/i,
    ],
  },
  {
    kind: 'already_known',
    patterns: [
      /这个我?(已经)?(会|掌握|认识)了?/,
      /我(已经)?(会|掌握|知道)(这个|它)了?/,
      /太简单了/,
      /i\s+(already\s+)?know\s+(this|that|it)/i,
      /too\s+easy/i,
    ],
  },
  {
    kind: 'reject_recommendation',
    patterns: [
      /(这个|这条)?建议?不(适合|想要|合适)/,
      /换一个/,
      /不想(做|练)这个/,
      /(not|don'?t)\s+want\s+this/i,
      /something\s+else/i,
    ],
  },
  {
    kind: 'skip',
    patterns: [/跳过/, /下一个/, /\bskip\b/i, /\bnext\b/i],
  },
  {
    kind: 'pause',
    patterns: [/暂停/, /先停(一下)?/, /\bpause\b/i],
  },
  {
    kind: 'end',
    patterns: [/结束(吧|学习)?/, /不学了/, /退出/, /\b(stop|end|quit|exit)\b/i],
  },
  {
    kind: 'resume',
    patterns: [
      /继续(上次|刚才)(的)?/,
      /接着(上次|刚才)/,
      /继续吧/,
      /\b(resume|continue)\b/i,
    ],
  },
  {
    kind: 'save_this',
    patterns: [
      /(把)?(这个|它)?(保存|记下|存起来|收藏)/,
      /加入(我的)?(知识库|生词本)/,
      /\bsave\s+(this|that|it)\b/i,
      /\badd\s+(this|that)\s+to\b/i,
    ],
  },
  {
    kind: 'review_now',
    patterns: [/(现在)?(想)?复习/, /背(一下)?单词/, /\breview\b/i, /\bflashcards?\b/i],
  },
];

export function detectCommands(input: string): UserCommand[] {
  const text = input.trim();
  if (!text) return [];

  const commands: UserCommand[] = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (match) {
        commands.push({ kind: rule.kind, matched: match[0] });
        break;
      }
    }
  }

  const minutes = parseAvailableMinutes(text);
  if (minutes !== null) {
    commands.push({ kind: 'time_limit', value: minutes, matched: `${minutes}min` });
  }

  // "Correct me" and "don't correct me" cannot both apply; negation wins.
  if (commands.some((command) => command.kind === 'disable_correction')) {
    return commands.filter((command) => command.kind !== 'enable_correction');
  }
  return commands;
}

export function hasCommand(commands: UserCommand[], kind: UserCommandKind): boolean {
  return commands.some((command) => command.kind === kind);
}

export function commandValue(
  commands: UserCommand[],
  kind: UserCommandKind,
): number | undefined {
  return commands.find((command) => command.kind === kind)?.value;
}
