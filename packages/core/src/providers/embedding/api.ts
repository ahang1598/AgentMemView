import type { EmbeddingProvider } from "../../embedding/provider.js";

/** OpenAI-compatible embedding gateway provider (capability center opt-in). */

export interface ApiEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dims: number;
}

export interface ApiEmbeddingOptions {
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

export class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "api";
  readonly model: string;
  readonly dims: number;
  readonly #config: ApiEmbeddingConfig;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(config: ApiEmbeddingConfig, options: ApiEmbeddingOptions = {}) {
    this.#config = config;
    this.model = config.model;
    this.dims = config.dims;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.#config.baseUrl.replace(/\/$/, "")}/embeddings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#config.apiKey}`,
        },
        body: JSON.stringify({ model: this.#config.model, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`embedding gateway responded ${res.status}`);
      }
      const parsed = (await res.json()) as {
        data?: Array<{ index?: number; embedding?: number[] }>;
      };
      const rows = parsed.data ?? [];
      return texts.map((_text, i) => {
        const row = rows.find((r) => (r.index ?? i) === i) ?? rows[i];
        const vector = row?.embedding;
        if (vector === undefined || vector.length !== this.dims) {
          throw new Error(`embedding gateway returned unexpected dims for index ${i}`);
        }
        return vector;
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`embedding gateway timeout after ${this.#timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
