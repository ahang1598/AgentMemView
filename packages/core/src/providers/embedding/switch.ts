import type { AgentMemViewDatabase } from "../../db/database.js";
import { ensureVecTable } from "../../db/vecTables.js";
import type { JobQueue } from "../../jobs/queue.js";

/**
 * Embedding triple governance (supermemory lesson, inverted): switching the
 * active provider NEVER rejects service — it creates the new vec namespace,
 * marks it pending-rebuild, queues a background re-embed job, and search
 * falls back to keyword-only for that namespace until rebuilt.
 */

export interface SwitchInput {
  provider: string;
  model: string;
  dims: number;
}

export interface SwitchReport {
  table: string;
  activeKey: string;
  pendingRebuild: boolean;
}

function readConfig(db: AgentMemViewDatabase, key: string): unknown {
  const row = db.prepare("SELECT value_json FROM config WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (row === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(row.value_json);
  } catch {
    return undefined;
  }
}

export function switchEmbeddingProvider(
  db: AgentMemViewDatabase,
  queue: JobQueue,
  input: SwitchInput,
): SwitchReport {
  const table = ensureVecTable(db, input.provider, input.model, input.dims);
  const activeKey = `${input.provider}_${input.model}_${input.dims}`;
  const previousKey = readConfig(db, "embedding.activeKey");
  db.prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)").run(
    "embedding.activeKey",
    JSON.stringify(activeKey),
  );

  const existingPending = (readConfig(db, "pending_rebuild") as string[] | undefined) ?? [];
  if (!existingPending.includes(activeKey)) {
    db.prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)").run(
      "pending_rebuild",
      JSON.stringify([...existingPending, activeKey]),
    );
  }

  queue.enqueue("embedding.rebuild", {
    from: typeof previousKey === "string" ? previousKey : null,
    to: activeKey,
    table,
  });
  return { table, activeKey, pendingRebuild: true };
}
