import type { TelemetrySink } from '@/domain/ports';

export interface TelemetryEntry {
  kind: string;
  at: string;
  latencyMs?: number;
  ok: boolean;
  detail?: Record<string, unknown>;
}

const SECRET_KEYS = /(key|token|secret|authorization|password|apikey)/i;
const MAX_ENTRIES = 200;

/** Removes anything that looks like a credential before it can be logged. */
export function redact(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SECRET_KEYS.test(key)) {
      output[key] = '[redacted]';
    } else if (typeof value === 'string' && value.length > 200) {
      output[key] = `${value.slice(0, 200)}…`;
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * In-memory ring buffer. Enough for the diagnostics panel in V0.1; no external
 * analytics service and no user content is stored here.
 */
export class InMemoryTelemetry implements TelemetrySink {
  private entries: TelemetryEntry[] = [];

  record(entry: TelemetryEntry): void {
    this.entries.push({ ...entry, detail: redact(entry.detail) });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
  }

  list(limit = 50): TelemetryEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  stats(): {
    total: number;
    failures: number;
    aiCalls: number;
    aiFailures: number;
    degradations: number;
    inputTokens: number;
    outputTokens: number;
    avgAiLatencyMs: number | null;
  } {
    const aiEntries = this.entries.filter((entry) => entry.kind.startsWith('ai.'));
    const latencies = aiEntries
      .map((entry) => entry.latencyMs)
      .filter((value): value is number => typeof value === 'number');
    const sumTokens = (field: 'inputTokens' | 'outputTokens'): number =>
      aiEntries.reduce((sum, entry) => {
        const value = entry.detail?.[field];
        return sum + (typeof value === 'number' ? value : 0);
      }, 0);

    return {
      total: this.entries.length,
      failures: this.entries.filter((entry) => !entry.ok).length,
      aiCalls: aiEntries.length,
      aiFailures: aiEntries.filter((entry) => !entry.ok).length,
      degradations: this.entries.filter((entry) => entry.kind === 'ai.degraded').length,
      inputTokens: sumTokens('inputTokens'),
      outputTokens: sumTokens('outputTokens'),
      avgAiLatencyMs:
        latencies.length > 0
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : null,
    };
  }

  clear(): void {
    this.entries = [];
  }
}

const globalForTelemetry = globalThis as unknown as { __llaTelemetry?: InMemoryTelemetry };

export function getTelemetry(): InMemoryTelemetry {
  if (!globalForTelemetry.__llaTelemetry) {
    globalForTelemetry.__llaTelemetry = new InMemoryTelemetry();
  }
  return globalForTelemetry.__llaTelemetry;
}
