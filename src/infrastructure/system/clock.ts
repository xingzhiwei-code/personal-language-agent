import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '@/domain/ports';

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};

export const uuidIdGenerator: IdGenerator = {
  next: () => randomUUID(),
};

/** Deterministic clock/id for tests. */
export function fixedClock(iso: string): Clock {
  const date = new Date(iso);
  return { now: () => date, nowIso: () => date.toISOString() };
}

export function sequentialIdGenerator(prefix = 'id'): IdGenerator {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
