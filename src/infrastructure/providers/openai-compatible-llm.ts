import { DomainError } from '@/domain/errors';
import type { LLMProvider, LlmCompletionRequest, LlmCompletionResult } from '@/domain/ports';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/**
 * Minimal OpenAI-compatible chat client implemented with `fetch`.
 * Deliberately SDK-free: swapping vendors means adding another LLMProvider,
 * and no vendor package ever reaches the domain layer.
 *
 * Secrets come from the environment only — never from code or the database.
 */
export class OpenAiCompatibleLlmProvider implements LLMProvider {
  readonly name: string;
  private readonly config: OpenAiCompatibleConfig;

  constructor(config?: Partial<OpenAiCompatibleConfig>) {
    this.config = {
      baseUrl: (config?.baseUrl ?? process.env.LLA_LLM_BASE_URL ?? '').replace(/\/+$/, ''),
      apiKey: config?.apiKey ?? process.env.LLA_LLM_API_KEY ?? '',
      model: config?.model ?? process.env.LLA_LLM_MODEL ?? 'gpt-4o-mini',
      timeoutMs: config?.timeoutMs ?? Number(process.env.LLA_LLM_TIMEOUT_MS ?? 20_000),
    };
    this.name = `openai-compatible:${this.config.model}`;
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0 && this.config.baseUrl.length > 0;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.isConfigured()) {
      throw new DomainError('ai_unavailable', 'LLM provider is not configured');
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onExternalAbort);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxOutputTokens ?? 600,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Never surface provider bodies (may contain keys/ids) to the user.
        throw new DomainError('ai_unavailable', `LLM provider returned ${response.status}`, {
          status: response.status,
        });
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };

      const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
      if (text.length === 0) {
        throw new DomainError('ai_unavailable', 'LLM provider returned an empty response');
      }

      return {
        text,
        model: payload.model ?? this.config.model,
        usage: {
          inputTokens: payload.usage?.prompt_tokens,
          outputTokens: payload.usage?.completion_tokens,
        },
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DomainError('ai_timeout', `LLM request timed out after ${timeoutMs}ms`);
      }
      throw new DomainError('ai_unavailable', 'LLM request failed');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

/** Always-unavailable provider used when no key is configured. */
export class NullLlmProvider implements LLMProvider {
  readonly name = 'none';
  isConfigured(): boolean {
    return false;
  }
  async complete(): Promise<LlmCompletionResult> {
    throw new DomainError('ai_unavailable', 'No LLM provider configured');
  }
}

export function createLlmProvider(): LLMProvider {
  const provider = new OpenAiCompatibleLlmProvider();
  return provider.isConfigured() ? provider : new NullLlmProvider();
}
