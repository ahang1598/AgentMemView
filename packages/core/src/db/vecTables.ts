import type { AgentMemViewDatabase } from "./database.js";

/**
 * Per-triple sqlite-vec tables: vec_facts_{provider}_{model}_{dims}.
 * Splitting by embedding triple avoids the "dimension lock" pitfall — switching
 * providers creates a new table instead of invalidating existing vectors.
 */

const TRIPLE_PART = /^[a-z0-9][a-z0-9_-]*$/i;

/** Build the canonical vec table name for an embedding triple. */
export function vecTableName(provider: string, model: string, dims: number): string {
  return `vec_facts_${provider}_${model}_${dims}`;
}

/**
 * Validate a provider/model identifier before it is interpolated into DDL.
 * Whitelist-only: prevents SQL injection via crafted triples.
 */
function assertTriplePart(value: string, label: string): void {
  if (!TRIPLE_PART.test(value)) {
    throw new Error(
      `invalid ${label} "${value}": only [a-z0-9_-] characters allowed (starting alphanumeric)`,
    );
  }
}

/**
 * Create (idempotently) the vec0 virtual table for the given embedding triple
 * and return its name. Throws on invalid triples or non-positive dims.
 */
export function ensureVecTable(
  db: AgentMemViewDatabase,
  provider: string,
  model: string,
  dims: number,
): string {
  assertTriplePart(provider, "provider");
  assertTriplePart(model, "model");
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new Error(`invalid dims ${dims}: must be a positive integer`);
  }
  const name = vecTableName(provider, model, dims);
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS "${name}" USING vec0(` +
      `fact_id TEXT PRIMARY KEY, embedding FLOAT[${dims}])`,
  );
  return name;
}
