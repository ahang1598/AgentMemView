import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./provider.js";

/**
 * Deterministic test provider: trigram-bag hash projection.
 * Each codepoint trigram maps to a signed dimension; texts sharing trigrams
 * get similar vectors. Deterministic and offline — used for pipeline tests
 * and the synthetic retrieval eval, never in production.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "mock";
  readonly model = "hash-projection";
  readonly dims: number;

  constructor(dims = 384) {
    this.dims = dims;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => project(text, this.dims));
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function project(text: string, dims: number): number[] {
  const vector = new Array<number>(dims).fill(0);
  const chars = [...normalize(text)];
  if (chars.length < 3) {
    // short text: hash the whole string into a few dimensions instead
    accumulate(vector, digestOf(text), dims);
    return unit(vector);
  }
  for (let i = 0; i + 3 <= chars.length; i += 1) {
    const trigram = chars.slice(i, i + 3).join("");
    accumulate(vector, digestOf(trigram), dims);
  }
  return unit(vector);
}

function digestOf(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

function accumulate(vector: number[], digest: Buffer, dims: number): void {
  // two dimensions per trigram for better spread
  for (let offset = 0; offset < 8; offset += 4) {
    const raw = digest.readUInt32LE(offset);
    const index = raw % dims;
    const sign = (digest[offset + 3] ?? 0) % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
}

function unit(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((x) => x / norm);
}
