import { describe, expect, it } from "vitest";
import { isLocalModelAvailable, LocalEmbeddingProvider } from "../../src/embedding/local.js";
import { MockEmbeddingProvider } from "../../src/embedding/mock.js";
import {
  assertDims,
  EmbeddingDimError,
  type EmbeddingProvider,
} from "../../src/embedding/provider.js";

describe("embedding providers", () => {
  it("mock provider is deterministic", async () => {
    const provider = new MockEmbeddingProvider();
    const [a] = await provider.embed(["用户偏好 pnpm"]);
    const [b] = await provider.embed(["用户偏好 pnpm"]);
    const [c] = await provider.embed(["完全不同的文本"]);
    expect(provider.dims).toBe(384);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    // normalized
    const norm = Math.sqrt((a ?? []).reduce((sum, x) => sum + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-5);
  });

  it("dimension mismatch rejected", async () => {
    const provider: EmbeddingProvider = new MockEmbeddingProvider();
    const [vector] = await provider.embed(["text"]);
    const wrong = (vector ?? []).slice(0, 128);
    expect(() => assertDims(provider, wrong)).toThrow(EmbeddingDimError);
    expect(() => assertDims(provider, vector ?? [])).not.toThrow();
  });

  it("local provider returns 384-dim normalized vectors", async (ctx) => {
    const available = await isLocalModelAvailable();
    if (!available) {
      console.warn(
        "local embedding model unavailable; skipping (set AGENTMEMVIEW_HF_ENDPOINT for mirror)",
      );
      ctx.skip();
      return;
    }
    const provider = new LocalEmbeddingProvider();
    const [vector] = await provider.embed(["用户偏好 pnpm 而非 npm"]);
    expect(provider.dims).toBe(384);
    expect(vector).toHaveLength(384);
    const norm = Math.sqrt((vector ?? []).reduce((sum, x) => sum + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-3);
  });
});
