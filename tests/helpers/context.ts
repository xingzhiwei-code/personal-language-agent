import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '@/application/types';
import { LOCAL_LEARNER_ID } from '@/application/types';
import type { Clock, LLMProvider, LlmCompletionResult } from '@/domain/ports';
import { DomainError } from '@/domain/errors';
import { createDb, type Db } from '@/infrastructure/db/client';
import { InMemoryTelemetry } from '@/infrastructure/observability/telemetry';
import { createSqliteRepositories } from '@/infrastructure/repositories/sqlite';
import { LocalObjectStorage } from '@/infrastructure/storage/local-object-storage';
import { uuidIdGenerator } from '@/infrastructure/system/clock';

export { LOCAL_LEARNER_ID };

/** Clock that tests can move forward deterministically. */
export class TestClock implements Clock {
  private current: number;

  constructor(iso = '2026-01-01T09:00:00.000Z') {
    this.current = Date.parse(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  advanceMinutes(minutes: number): void {
    this.current += minutes * 60_000;
  }

  advanceDays(days: number): void {
    this.current += days * 86_400_000;
  }
}

export class FakeLlmProvider implements LLMProvider {
  readonly name = 'fake';
  configured = true;
  failWith: 'none' | 'timeout' | 'unavailable' = 'none';
  reply = '这是一个测试回答。';
  calls = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  async complete(): Promise<LlmCompletionResult> {
    this.calls += 1;
    if (this.failWith === 'timeout') {
      throw new DomainError('ai_timeout', 'timed out');
    }
    if (this.failWith === 'unavailable') {
      throw new DomainError('ai_unavailable', 'unavailable');
    }
    return { text: this.reply, model: 'fake-model', latencyMs: 5 };
  }
}

export interface TestHarness {
  ctx: AppContext;
  db: Db;
  clock: TestClock;
  llm: FakeLlmProvider;
  telemetry: InMemoryTelemetry;
  dir: string;
  dbPath: string;
  /** Re-opens the same database file, simulating an application restart. */
  reopen(): TestHarness;
  cleanup(): void;
}

export function createTestHarness(options: { dir?: string; iso?: string } = {}): TestHarness {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'lla-test-'));
  const dbPath = join(dir, 'test.db');
  const db = createDb({ path: dbPath });
  const clock = new TestClock(options.iso);
  const llm = new FakeLlmProvider();
  const telemetry = new InMemoryTelemetry();

  const ctx: AppContext = {
    repos: createSqliteRepositories(db),
    clock,
    ids: uuidIdGenerator,
    storage: new LocalObjectStorage(join(dir, 'objects')),
    llm,
    telemetry,
  };

  return {
    ctx,
    db,
    clock,
    llm,
    telemetry,
    dir,
    dbPath,
    reopen() {
      db.$client.close();
      return createTestHarness({ dir, iso: clock.nowIso() });
    },
    cleanup() {
      try {
        db.$client.close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
