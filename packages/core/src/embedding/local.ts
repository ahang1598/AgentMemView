import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { EmbeddingProvider } from "./provider.js";

/**
 * Local transformers.js provider: multilingual-e5-small (384 dims).
 * The heavy dependency is loaded dynamically so installs stay light; when it
 * is missing, the capability center falls back to another provider (AC-09).
 *
 * Model cache lives in ~/.AgentMemView/models; Chinese networks can point
 * AGENTMEMVIEW_HF_ENDPOINT at a mirror (e.g. https://hf-mirror.com).
 */

export const LOCAL_MODEL_ID = "Xenova/multilingual-e5-small";
export const LOCAL_MODEL_DIMS = 384;

type FeatureExtractor = (
  texts: string[],
  opts?: Record<string, unknown>,
) => Promise<Array<{ data: Float32Array | number[] }>>;

function modelCacheDir(): string {
  return path.join(homedir(), ".AgentMemView", "models");
}

async function loadTransformers(): Promise<{
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
}> {
  const specifier = "@huggingface/transformers";
  try {
    return (await import(specifier)) as {
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
    };
  } catch {
    throw new Error(
      "local embedding unavailable: @huggingface/transformers is not installed. " +
        "Install it, or configure the sidecar/API embedding provider in the capability center. " +
        "For mirror downloads set AGENTMEMVIEW_HF_ENDPOINT (e.g. https://hf-mirror.com).",
    );
  }
}

/**
 * Available = transformers.js installed AND model cache pre-populated (or
 * downloads explicitly allowed via AGENTMEMVIEW_ALLOW_DOWNLOAD=1). Keeps CI
 * and first-run behavior predictable.
 */
export async function isLocalModelAvailable(): Promise<boolean> {
  try {
    await loadTransformers();
  } catch {
    return false;
  }
  const cacheHit = existsSync(modelCacheDir());
  const allowDownload = process.env.AGENTMEMVIEW_ALLOW_DOWNLOAD === "1";
  return cacheHit || allowDownload;
}

/** Process-internal LRU keyed by sha1(text). */
class LruCache {
  readonly #map = new Map<string, number[]>();

  constructor(private readonly max: number) {}

  get(key: string): number[] | undefined {
    const hit = this.#map.get(key);
    if (hit !== undefined) {
      // refresh recency
      this.#map.delete(key);
      this.#map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: number[]): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.max) {
      const oldest = this.#map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#map.delete(oldest);
    }
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "local";
  readonly model = "e5-small";
  readonly dims = LOCAL_MODEL_DIMS;

  readonly #cache = new LruCache(1024);
  #extractor: FeatureExtractor | undefined;

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.extractor();
    const results: number[][] = [];
    const missing: Array<{ index: number; text: string }> = [];
    texts.forEach((text, index) => {
      const key = sha1(text);
      const hit = this.#cache.get(key);
      if (hit !== undefined) {
        results[index] = hit;
      } else {
        missing.push({ index, text });
      }
    });
    if (missing.length > 0) {
      // e5 models expect a "query: "/"passage: " prefix; symmetric use here.
      const outputs = await extractor(
        missing.map((m) => `passage: ${m.text}`),
        {
          pooling: "mean",
          normalize: true,
        },
      );
      missing.forEach((m, i) => {
        const data = outputs[i];
        if (data === undefined) {
          throw new Error(`embedding failed for text at index ${m.index}`);
        }
        const vector = Array.from(data.data as Float32Array);
        this.#cache.set(sha1(m.text), vector);
        results[m.index] = vector;
      });
    }
    return results;
  }

  private async extractor(): Promise<FeatureExtractor> {
    if (this.#extractor !== undefined) {
      return this.#extractor;
    }
    const transformers = await loadTransformers();
    const endpoint = process.env.AGENTMEMVIEW_HF_ENDPOINT;
    if (endpoint !== undefined && endpoint.length > 0) {
      (transformers as Record<string, unknown>).env = {
        ...((transformers as Record<string, unknown>).env as Record<string, unknown> | undefined),
        remoteHost: endpoint,
      };
    }
    const pipe = await transformers.pipeline("feature-extraction", LOCAL_MODEL_ID, {
      cache_dir: modelCacheDir(),
    });
    this.#extractor = pipe as FeatureExtractor;
    return this.#extractor;
  }
}

function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}
