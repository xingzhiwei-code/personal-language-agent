import type { Intent } from '@/domain/enums';
import { detectCommands, type UserCommand, type UserCommandKind } from '@/nlu/commands';
import { detectIntent } from '@/nlu/intent';
import { extractTerm } from './term';

export type DeterministicAction =
  | 'disable_correction'
  | 'enable_correction'
  | 'chat_only'
  | 'set_time'
  | 'start_review'
  | 'resume'
  | 'pause'
  | 'end'
  | 'skip'
  | 'save_this'
  | 'already_known'
  | 'reject_recommendation';

export type AgentRoute =
  | {
      kind: 'deterministic';
      action: DeterministicAction;
      commands: UserCommand[];
      intent: Intent;
      term: string | null;
      minutes?: number;
    }
  | {
      kind: 'llm';
      task: 'chat' | 'explain';
      commands: UserCommand[];
      intent: Intent;
      term: string | null;
    }
  | {
      kind: 'degraded';
      reason: 'ai_unconfigured';
      commands: UserCommand[];
      intent: Intent;
      term: string | null;
    };

/**
 * Command -> action priority. Explicit user control always beats inference,
 * and every one of these is handled without an LLM call.
 */
const COMMAND_PRIORITY: { kind: UserCommandKind; action: DeterministicAction }[] = [
  { kind: 'disable_correction', action: 'disable_correction' },
  { kind: 'enable_correction', action: 'enable_correction' },
  { kind: 'already_known', action: 'already_known' },
  { kind: 'save_this', action: 'save_this' },
  { kind: 'end', action: 'end' },
  { kind: 'pause', action: 'pause' },
  { kind: 'resume', action: 'resume' },
  { kind: 'skip', action: 'skip' },
  { kind: 'reject_recommendation', action: 'reject_recommendation' },
  { kind: 'review_now', action: 'start_review' },
  { kind: 'chat_only', action: 'chat_only' },
];

/**
 * AI Router (PRD §10.5): deterministic rules first, LLM only for tasks that
 * genuinely need language understanding or generation. We never add an LLM
 * call just to look "agentic".
 */
export function routeMessage(input: { text: string; aiAvailable: boolean }): AgentRoute {
  const text = input.text.trim();
  const commands = detectCommands(text);
  const { intent } = detectIntent(text);
  const term = extractTerm(text);

  for (const entry of COMMAND_PRIORITY) {
    const command = commands.find((candidate) => candidate.kind === entry.kind);
    if (command) {
      return { kind: 'deterministic', action: entry.action, commands, intent, term };
    }
  }

  const timeLimit = commands.find((command) => command.kind === 'time_limit');
  if (timeLimit) {
    return {
      kind: 'deterministic',
      action: 'set_time',
      commands,
      intent,
      term,
      minutes: timeLimit.value,
    };
  }

  if (!input.aiAvailable) {
    return { kind: 'degraded', reason: 'ai_unconfigured', commands, intent, term };
  }

  return {
    kind: 'llm',
    task: intent === 'exploration' ? 'explain' : 'chat',
    commands,
    intent,
    term,
  };
}
