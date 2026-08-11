import path from "node:path";
import { exportMempack, importMempack, migrate, openDatabase } from "@agentmemview/core";
import { dataHome } from "./start.js";

/**
 * `agentmemview export/import` — .mempack migration (AC-10).
 * The active embedding triple defaults to local/e5-small/384 (Spec D2).
 */

const DEFAULT_TRIPLE = { provider: "local", model: "e5-small", dims: 384 };

export interface ExportCliOptions {
  data?: string;
  out?: string;
}

export async function exportAction(options: ExportCliOptions): Promise<void> {
  const home = dataHome(options.data);
  const dbPath = path.join(home, "agentmemview.db");
  const out = options.out ?? path.join(home, "agentmemview.mempack");
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const manifest = await exportMempack(db, out, { embedding: DEFAULT_TRIPLE });
    console.log(
      `exported ${manifest.counts.l1Facts} facts to ${out} ` +
        `(schema ${manifest.schemaVersions.length} versions, embeddings: ${manifest.embeddings.map((e) => `${e.provider}/${e.model}/${e.dims}`).join(", ")})`,
    );
  } finally {
    db.close();
  }
}

export interface ImportCliOptions {
  data?: string;
  force?: boolean;
}

export async function importAction(packPath: string, options: ImportCliOptions): Promise<void> {
  const home = dataHome(options.data);
  const target = path.join(home, "agentmemview.db");
  const report = await importMempack(packPath, target, { activeEmbedding: DEFAULT_TRIPLE });
  if (report.pendingRebuild.length > 0) {
    console.log(
      `imported with pending vector rebuild for: ${report.pendingRebuild.join(", ")} ` +
        "(embeddings from another provider; search degrades to FTS until rebuilt)",
    );
  } else {
    console.log(`imported ${packPath} into ${target}`);
  }
}
