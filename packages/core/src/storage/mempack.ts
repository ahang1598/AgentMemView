import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMemViewDatabase } from "../db/database.js";
import { openDatabase } from "../db/database.js";
import { packTarGz, unpackTarGz } from "./tar.js";

/**
 * .mempack migration bundle (AC-10): SQLite online backup + manifest.json in
 * a gzipped tar. Dim-mismatched embeddings are marked pending-rebuild instead
 * of rejecting the import.
 */

export const MEMPACK_FORMAT = "agentmemview-mempack/1";

export interface EmbeddingTriple {
  provider: string;
  model: string;
  dims: number;
}

export interface MempackManifest {
  format: typeof MEMPACK_FORMAT;
  exportedAt: string;
  schemaVersions: string[];
  /** Active triple plus every vec_facts_* table found in the database. */
  embeddings: EmbeddingTriple[];
  counts: { l1Facts: number; l0Messages: number; sessions: number };
}

export interface ExportOptions {
  /** The embedding triple active at export time. */
  embedding?: EmbeddingTriple;
}

export interface ImportOptions {
  /** Triple active on the target machine; others get flagged for rebuild. */
  activeEmbedding?: EmbeddingTriple;
}

export interface ImportReport {
  pendingRebuild: string[];
}

function tripleKey(triple: EmbeddingTriple): string {
  return `${triple.provider}_${triple.model}_${triple.dims}`;
}

function vecTriplesInDb(db: AgentMemViewDatabase): EmbeddingTriple[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'vec_facts_%'")
    .all() as Array<{ name: string }>;
  const triples: EmbeddingTriple[] = [];
  for (const row of rows) {
    const parsed = parseVecTableName(row.name);
    if (parsed !== undefined) {
      triples.push(parsed);
    }
  }
  return triples;
}

function parseVecTableName(name: string): EmbeddingTriple | undefined {
  const match = /^vec_facts_(.+)_(\d+)$/.exec(name);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  const rest = match[1];
  const modelSplit = rest.lastIndexOf("_");
  if (modelSplit <= 0) {
    return undefined;
  }
  const provider = rest.slice(0, modelSplit);
  const model = rest.slice(modelSplit + 1);
  const dims = Number.parseInt(match[2], 10);
  if (provider.length === 0 || model.length === 0 || Number.isNaN(dims)) {
    return undefined;
  }
  return { provider, model, dims };
}

function count(db: AgentMemViewDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

export async function exportMempack(
  db: AgentMemViewDatabase,
  packPath: string,
  options: ExportOptions = {},
): Promise<MempackManifest> {
  const staging = mkdtempSync(path.join(tmpdir(), "agentmemview-mempack-"));
  try {
    const snapshotPath = path.join(staging, "agentmemview.db");
    // online backup: consistent snapshot without blocking writers for long
    await db.backup(snapshotPath);

    const schemaVersions = (
      db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
        version: string;
      }>
    ).map((row) => row.version);

    const embeddings: EmbeddingTriple[] = [];
    const seen = new Set<string>();
    for (const triple of [
      ...(options.embedding !== undefined ? [options.embedding] : []),
      ...vecTriplesInDb(db),
    ]) {
      const key = tripleKey(triple);
      if (!seen.has(key)) {
        seen.add(key);
        embeddings.push(triple);
      }
    }

    const manifest: MempackManifest = {
      format: MEMPACK_FORMAT,
      exportedAt: new Date().toISOString(),
      schemaVersions,
      embeddings,
      counts: {
        l1Facts: count(db, "l1_facts"),
        l0Messages: count(db, "l0_messages"),
        sessions: count(db, "sessions"),
      },
    };

    const archive = packTarGz([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
      { name: "agentmemview.db", data: readFileSync(snapshotPath) },
    ]);
    writeFileSync(packPath, archive);
    return manifest;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function importMempack(
  packPath: string,
  targetDbPath: string,
  options: ImportOptions = {},
): Promise<ImportReport> {
  if (existsSync(targetDbPath)) {
    throw new Error(`refusing to overwrite existing database at ${targetDbPath}`);
  }
  const entries = unpackTarGz(readFileSync(packPath));
  const manifestEntry = entries.find((e) => e.name === "manifest.json");
  const dbEntry = entries.find((e) => e.name === "agentmemview.db");
  if (manifestEntry === undefined || dbEntry === undefined) {
    throw new Error("invalid .mempack: manifest.json or agentmemview.db missing");
  }
  const manifest = JSON.parse(manifestEntry.data.toString("utf8")) as MempackManifest;
  if (manifest.format !== MEMPACK_FORMAT) {
    throw new Error(`unsupported .mempack format: ${String(manifest.format)}`);
  }

  writeFileSync(targetDbPath, dbEntry.data);

  // mark non-active embedding triples as pending rebuild (never reject)
  const pendingRebuild = manifest.embeddings
    .filter(
      (triple) =>
        options.activeEmbedding !== undefined &&
        tripleKey(triple) !== tripleKey(options.activeEmbedding),
    )
    .map(tripleKey);
  if (pendingRebuild.length > 0) {
    const target = openDatabase(targetDbPath);
    try {
      target
        .prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)")
        .run("pending_rebuild", JSON.stringify(pendingRebuild));
    } finally {
      target.close();
    }
  }
  return { pendingRebuild };
}

/** Copy helper kept for CLI symmetry with the backup flow. */
export function copyDatabase(source: string, target: string): void {
  copyFileSync(source, target);
}
