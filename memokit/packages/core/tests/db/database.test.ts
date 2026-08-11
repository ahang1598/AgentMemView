import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/database.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memokit-db-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("openDatabase", () => {
  it("opens with WAL journal mode and foreign keys on", () => {
    const dir = makeTempDir();
    const db = openDatabase(path.join(dir, "memokit.db"));
    try {
      const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(journal.journal_mode).toBe("wal");
      const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      expect(fk.foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });

  it("vec extension loads and computes cosine distance on 384-dim vectors", () => {
    const dir = makeTempDir();
    const db = openDatabase(path.join(dir, "memokit.db"));
    try {
      const dims = 384;
      const a = new Float32Array(dims);
      a[0] = 1;
      const b = new Float32Array(dims);
      b[0] = 0.6;
      b[1] = 0.8;
      const row = db
        .prepare("SELECT vec_distance_cosine(vec_f32(?), vec_f32(?)) AS dist")
        .get(Buffer.from(a.buffer), Buffer.from(b.buffer)) as { dist: number };
      expect(row.dist).toBeGreaterThanOrEqual(0);
      expect(row.dist).toBeLessThanOrEqual(2);
    } finally {
      db.close();
    }
  });
});
