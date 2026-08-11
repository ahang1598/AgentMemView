import type { AgentMemViewDatabase } from "../db/database.js";
import type { EventBus } from "../events/bus.js";

/**
 * Ebbinghaus decay scan: active, unpinned facts whose decay factor falls
 * below the threshold are marked forgotten (never physically deleted —
 * recoverable from the Dashboard, part of the observability narrative).
 */

export interface DecayCandidate {
  id: string;
  content: string;
  factor: number;
}

export interface DecayScanOptions {
  bus?: EventBus | undefined;
  nowMs?: (() => number) | undefined;
  threshold?: number | undefined;
  dryRun?: boolean | undefined;
}

export interface DecayScanResult {
  candidates: DecayCandidate[];
  forgotten: number;
}

const DEFAULT_THRESHOLD = 0.05;

export function runDecayScan(
  db: AgentMemViewDatabase,
  options: DecayScanOptions = {},
): DecayScanResult {
  const nowMs = options.nowMs !== undefined ? options.nowMs() : Date.now();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const rows = db
    .prepare(
      `SELECT id, content, pinned, half_life_days, last_accessed_at
       FROM l1_facts WHERE status = 'active'`,
    )
    .all() as Array<{
    id: string;
    content: string;
    pinned: number;
    half_life_days: number;
    last_accessed_at: string;
  }>;
  const candidates: DecayCandidate[] = [];
  for (const row of rows) {
    if (row.pinned === 1) {
      continue;
    }
    const days = Math.max(0, (nowMs - Date.parse(row.last_accessed_at)) / 86_400_000);
    const halfLife = row.half_life_days > 0 ? row.half_life_days : 30;
    const factor = 0.5 ** (days / halfLife);
    if (factor < threshold) {
      candidates.push({ id: row.id, content: row.content, factor });
    }
  }
  if (options.dryRun === true) {
    return { candidates, forgotten: 0 };
  }
  let forgotten = 0;
  const nowIso = new Date().toISOString();
  for (const candidate of candidates) {
    db.prepare("UPDATE l1_facts SET status = 'forgotten', updated_at = ? WHERE id = ?").run(
      nowIso,
      candidate.id,
    );
    db.prepare("DELETE FROM l1_facts_fts WHERE fact_id = ?").run(candidate.id);
    options.bus?.publish("decay.forgotten", { id: candidate.id, factor: candidate.factor });
    forgotten += 1;
  }
  return { candidates, forgotten };
}
