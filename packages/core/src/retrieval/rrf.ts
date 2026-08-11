/** Reciprocal Rank Fusion (Spec section 6 stage 3). */

export interface RankedHit {
  id: string;
  /** 1-based rank within its channel. */
  rank: number;
}

export interface FusedHit {
  id: string;
  score: number;
}

/**
 * Fuse multiple ranked channels: score(d) = Σ_c 1 / (k + rank_c(d)).
 * Default k = 60 per the locked pipeline.
 */
export function rrf(channels: RankedHit[][], k = 60): FusedHit[] {
  const scores = new Map<string, number>();
  for (const channel of channels) {
    for (const hit of channel) {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (k + hit.rank));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
