/**
 * EmbeddingProvider contract (Spec section 10). The retrieval engine depends
 * only on this interface; providers are swappable via the capability center.
 */

export interface EmbeddingProvider {
  /** Embedding triple identity: drives the per-triple vec table naming. */
  readonly providerName: string;
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingDimError extends Error {
  constructor(expected: number, actual: number) {
    super(`embedding dimension mismatch: table expects ${expected}, got ${actual}`);
    this.name = "EmbeddingDimError";
  }
}

/** Guard used before inserting into a vec table of a fixed dimension. */
export function assertDims(provider: EmbeddingProvider, vector: number[]): void {
  if (vector.length !== provider.dims) {
    throw new EmbeddingDimError(provider.dims, vector.length);
  }
}
