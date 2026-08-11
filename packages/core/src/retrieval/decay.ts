/** Ebbinghaus decay (Spec section 5): score × 0.5^(days since access / half_life). */

export interface DecayInput {
  lastAccessedAt: string;
  halfLifeDays: number;
  pinned: boolean;
  nowMs: number;
}

/** Pinned facts are exempt from decay and always keep factor 1. */
export function ebbinghausFactor(input: DecayInput): number {
  if (input.pinned) {
    return 1;
  }
  const lastMs = Date.parse(input.lastAccessedAt);
  const days = Math.max(0, (input.nowMs - lastMs) / 86_400_000);
  const halfLife = input.halfLifeDays > 0 ? input.halfLifeDays : 30;
  return 0.5 ** (days / halfLife);
}
