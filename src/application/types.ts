import type {
  Clock,
  IdGenerator,
  LLMProvider,
  ObjectStorage,
  Repositories,
  TelemetrySink,
} from '@/domain/ports';

/**
 * Application context: the single place where infrastructure is injected.
 * Services receive it explicitly, which keeps them testable with in-memory or
 * temp-file implementations and keeps the domain free of wiring.
 */
export interface AppContext {
  repos: Repositories;
  clock: Clock;
  ids: IdGenerator;
  storage: ObjectStorage;
  llm: LLMProvider;
  telemetry: TelemetrySink;
}

/** V0.1 is single-user and local-first. */
export const LOCAL_LEARNER_ID = 'local-learner';
