import type { AppContext } from '@/application/types';
import { getDb } from './db/client';
import { getTelemetry } from './observability/telemetry';
import { createLlmProvider } from './providers/openai-compatible-llm';
import { createSqliteRepositories } from './repositories/sqlite';
import { LocalObjectStorage } from './storage/local-object-storage';
import { systemClock, uuidIdGenerator } from './system/clock';

/**
 * Composition root. This is the only place where concrete infrastructure is
 * bound to the application ports.
 */
const globalForContext = globalThis as unknown as { __llaContext?: AppContext };

export function getAppContext(): AppContext {
  if (!globalForContext.__llaContext) {
    const db = getDb();
    globalForContext.__llaContext = {
      repos: createSqliteRepositories(db),
      clock: systemClock,
      ids: uuidIdGenerator,
      storage: new LocalObjectStorage(),
      llm: createLlmProvider(),
      telemetry: getTelemetry(),
    };
  }
  return globalForContext.__llaContext;
}

/** Forces the next `getAppContext()` to rebuild (used after config changes). */
export function resetAppContext(): void {
  globalForContext.__llaContext = undefined;
}
