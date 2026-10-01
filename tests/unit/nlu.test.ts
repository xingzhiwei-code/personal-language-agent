import { describe, expect, it } from 'vitest';
import { detectCommands, hasCommand } from '@/nlu/commands';
import { parseAvailableMinutes } from '@/nlu/duration';
import { parseGoalInput } from '@/nlu/goal';
import { detectIntent } from '@/nlu/intent';
import { extractTerm } from '@/agent/term';

describe('duration parsing', () => {
  it('understands Chinese and English durations', () => {
    expect(parseAvailableMinutes('我现在只有 3 分钟')).toBe(3);
    expect(parseAvailableMinutes('我只有三分钟')).toBe(3);
    expect(parseAvailableMinutes('十五分钟够吗')).toBe(15);
    expect(parseAvailableMinutes('I only have 5 minutes')).toBe(5);
    expect(parseAvailableMinutes('half an hour')).toBe(30);
    expect(parseAvailableMinutes('一个小时')).toBe(60);
    expect(parseAvailableMinutes('随便聊聊')).toBeNull();
  });
});

describe('user control commands', () => {
  it('detects "don\'t correct me" in both languages', () => {
    expect(hasCommand(detectCommands('不要纠正我的语法'), 'disable_correction')).toBe(true);
    expect(hasCommand(detectCommands('别纠错了'), 'disable_correction')).toBe(true);
    expect(hasCommand(detectCommands("don't correct my grammar"), 'disable_correction')).toBe(
      true,
    );
  });

  it('negation wins over enabling correction', () => {
    const commands = detectCommands('不要纠正我');
    expect(hasCommand(commands, 'disable_correction')).toBe(true);
    expect(hasCommand(commands, 'enable_correction')).toBe(false);
  });

  it('detects chat-only, already-known, skip and save', () => {
    expect(hasCommand(detectCommands('今天只想聊天'), 'chat_only')).toBe(true);
    expect(hasCommand(detectCommands('这个我已经会了'), 'already_known')).toBe(true);
    expect(hasCommand(detectCommands('跳过'), 'skip')).toBe(true);
    expect(hasCommand(detectCommands('把这个保存起来'), 'save_this')).toBe(true);
    expect(hasCommand(detectCommands('继续上次的'), 'resume')).toBe(true);
  });

  it('extracts a time limit as a command value', () => {
    const commands = detectCommands('我只有 3 分钟');
    const limit = commands.find((command) => command.kind === 'time_limit');
    expect(limit?.value).toBe(3);
  });
});

describe('intent detection', () => {
  it('routes explicit chat requests to conversation', () => {
    expect(detectIntent('今天只想聊天').intent).toBe('conversation');
    expect(detectIntent('我们聊聊吧').intent).toBe('conversation');
  });

  it('recognises exploration questions', () => {
    expect(detectIntent("What does 'figure out' mean?").intent).toBe('exploration');
    expect(detectIntent('figure out 是什么意思').intent).toBe('exploration');
  });

  it('recognises practice and learning intents', () => {
    expect(detectIntent('我想复习单词').intent).toBe('practice');
    expect(detectIntent('我想提高英语口语').intent).toBe('learning');
  });

  it('falls back to unknown without guessing', () => {
    expect(detectIntent('嗯').intent).toBe('unknown');
  });
});

describe('goal parsing', () => {
  it('parses "我想提高英语口语" into language + skills', () => {
    const parsed = parseGoalInput('我想提高英语口语');
    expect(parsed.languageCode).toBe('en');
    expect(parsed.languageConfidence).toBeGreaterThan(0.9);
    expect(parsed.skills[0]?.skill).toBe('speaking');
    expect(parsed.skills.some((entry) => entry.skill === 'vocabulary')).toBe(true);
  });

  it('detects scenarios and other languages', () => {
    const parsed = parseGoalInput('我想练日语面试对话');
    expect(parsed.languageCode).toBe('ja');
    expect(parsed.scenarios).toContain('面试');
  });

  it('defaults to English with low confidence when unspecified', () => {
    const parsed = parseGoalInput('想每天进步一点');
    expect(parsed.languageCode).toBe('en');
    expect(parsed.languageConfidence).toBeLessThan(0.5);
    expect(parsed.skills.length).toBeGreaterThan(0);
  });
});

describe('term extraction', () => {
  it('finds the expression the user asks about', () => {
    expect(extractTerm("What does 'figure out' mean?")).toBe('figure out');
    expect(extractTerm('「figure out」是什么意思')).toBe('figure out');
    expect(extractTerm('figure out 是什么意思')).toBe('figure out');
    expect(extractTerm('今天天气不错')).toBeNull();
  });
});
