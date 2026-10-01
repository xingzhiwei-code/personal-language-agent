import type { LearningEvent } from '@/domain/entities';
import type { EventSource, EventType } from '@/domain/enums';
import type { AppContext } from './types';

export const EVENT_VERSION = 1;

export interface AppendEventInput {
  learnerId: string;
  type: EventType;
  source: EventSource;
  sessionId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  /**
   * Stable key derived from the user action. Repeated submissions with the same
   * key never create a second event (PRD §9.1 / §12.9).
   */
  idempotencyKey: string;
}

export async function appendEvent(
  ctx: AppContext,
  input: AppendEventInput,
): Promise<{ event: LearningEvent; created: boolean }> {
  const now = ctx.clock.nowIso();
  const event: LearningEvent = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    sessionId: input.sessionId ?? null,
    type: input.type,
    occurredAt: input.occurredAt ?? now,
    payload: input.payload ?? {},
    source: input.source,
    version: EVENT_VERSION,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
  };
  return ctx.repos.events.append(event);
}

/** Builds a deterministic idempotency key from its parts. */
export function idempotencyKey(...parts: (string | number | null | undefined)[]): string {
  return parts
    .filter((part) => part !== null && part !== undefined && `${part}`.length > 0)
    .join(':')
    .slice(0, 200);
}
