import type { UserContext } from '@/domain/entities';
import type { AttentionLevel, Intent } from '@/domain/enums';
import { detectIntent } from '@/nlu/intent';
import { appendEvent } from './events';
import type { AppContext } from './types';

/**
 * A declared context expires: "I only have 3 minutes" must not constrain
 * tomorrow's recommendations.
 */
export const CONTEXT_TTL_MS = 90 * 60 * 1000;

export interface CaptureContextInput {
  learnerId: string;
  rawInput?: string | null;
  availableMinutes?: number | null;
  device?: UserContext['device'];
  intent?: Intent;
  attention?: AttentionLevel;
  canSpeak?: boolean;
  canListen?: boolean;
  canType?: boolean;
  canRead?: boolean;
  note?: string | null;
}

export async function captureContext(
  ctx: AppContext,
  input: CaptureContextInput,
): Promise<UserContext> {
  const now = ctx.clock.nowIso();
  const parsed = input.rawInput ? detectIntent(input.rawInput) : null;
  const parsedMinutes = parsed?.commands.find((command) => command.kind === 'time_limit')?.value;

  const context: UserContext = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    capturedAt: now,
    availableMinutes: input.availableMinutes ?? parsedMinutes ?? null,
    device: input.device ?? 'unknown',
    canSpeak: input.canSpeak ?? true,
    canListen: input.canListen ?? true,
    canType: input.canType ?? true,
    canRead: input.canRead ?? true,
    attention: input.attention ?? 'medium',
    intent: input.intent ?? parsed?.intent ?? 'unknown',
    note: input.note ?? null,
    rawInput: input.rawInput ?? null,
  };

  await ctx.repos.contexts.create(context);
  await appendEvent(ctx, {
    learnerId: input.learnerId,
    type: 'context_captured',
    source: 'user',
    idempotencyKey: `context:${context.id}`,
    payload: {
      availableMinutes: context.availableMinutes,
      intent: context.intent,
      device: context.device,
    },
  });

  return context;
}

/** Returns the latest context only while it is still plausibly true. */
export async function getCurrentContext(
  ctx: AppContext,
  learnerId: string,
): Promise<UserContext | null> {
  const latest = await ctx.repos.contexts.findLatest(learnerId);
  if (!latest) return null;
  const age = Date.parse(ctx.clock.nowIso()) - Date.parse(latest.capturedAt);
  return age <= CONTEXT_TTL_MS ? latest : null;
}
