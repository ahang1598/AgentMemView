/**
 * FTS5 trigram channel helpers (Spec section 6 stage 2a).
 *
 * Trigram tokenizer limits: query tokens shorter than 3 codepoints match
 * nothing via MATCH. For such short queries the engine MUST degrade to a
 * LIKE scan over the prefiltered candidate set (done in engine.ts).
 */

/** Split a query into words of alphanumeric/CJK runs. */
export function queryWords(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Build an FTS5 MATCH expression from a query: each word >= 3 codepoints
 * becomes a quoted phrase; joined with OR for recall. Returns null when no
 * word is long enough for the trigram index.
 */
export function buildFtsMatch(query: string): string | null {
  const tokens = queryWords(query)
    .filter((w) => [...w].length >= 3)
    .map((w) => `"${w.replace(/"/g, '""')}"`);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.join(" OR ");
}
