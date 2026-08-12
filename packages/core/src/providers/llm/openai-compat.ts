import type { ChatMessage, ChatResult, LLMProvider } from "./types.js";

/** OpenAI-compatible gateway provider: configurable baseURL/apiKey/model. */

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface OpenAICompatOptions {
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/** Field-level validation for the capability center form. */
export function validateLLMConfig(config: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const key of ["baseUrl", "apiKey", "model"]) {
    const value = config[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      missing.push(key);
    }
  }
  return missing;
}

export class OpenAICompatLLMProvider implements LLMProvider {
  readonly name = "openai-compat";
  readonly #config: OpenAICompatConfig;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(config: OpenAICompatConfig, options: OpenAICompatOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const url = `${this.#config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const body = JSON.stringify({ model: this.#config.model, messages });
    const attempt = async (): Promise<ChatResult> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const res = await this.#fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.#config.apiKey}`,
          },
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          await res.arrayBuffer().catch(() => undefined);
          const error = new Error(`llm gateway responded ${res.status}`);
          (error as Error & { status?: number }).status = res.status;
          throw error;
        }
        const parsed = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = parsed.choices?.[0]?.message?.content ?? "";
        const usage = parsed.usage;
        return {
          text,
          ...(usage !== undefined
            ? {
                usage: {
                  promptTokens: usage.prompt_tokens ?? 0,
                  completionTokens: usage.completion_tokens ?? 0,
                },
              }
            : {}),
        };
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(`llm gateway timeout after ${this.#timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };
    // retry transient failures (429 rate limit / 5xx) with backoff; gateways
    // like Zhipu throttle bursty refine calls, so one fast retry is not enough
    const maxAttempts = 3;
    let lastError: Error | undefined;
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        return await attempt();
      } catch (err) {
        lastError = err as Error;
        const status = (err as Error & { status?: number }).status;
        const retryable = status === 429 || (status !== undefined && status >= 500);
        if (!retryable || i === maxAttempts - 1) {
          throw err;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 2000 * (i + 1));
        });
      }
    }
    throw lastError ?? new Error("llm gateway request failed");
  }
}
