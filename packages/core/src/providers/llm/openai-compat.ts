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
          throw new Error(`llm gateway responded ${res.status}`);
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
    try {
      return await attempt();
    } catch (err) {
      // one retry for transient gateway failures
      if ((err as Error).message.includes("5")) {
        return attempt();
      }
      throw err;
    }
  }
}
