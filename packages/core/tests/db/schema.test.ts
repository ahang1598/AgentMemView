import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { ensureVecTable, vecTableName } from "../../src/db/vecTables.js";

const tempDirs: string[] = [];

function makeDb(): ReturnType<typeof openDatabase> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-schema-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  migrate(db);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function listTables(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe("0002_memory_core schema", () => {
  it("all business tables exist", () => {
    const db = makeDb();
    try {
      const tables = listTables(db);
      for (const expected of [
        "l0_messages",
        "l1_facts",
        "entities",
        "l1_fact_entities",
        "l2_scenarios",
        "l3_profiles",
        "skills",
        "knowledge",
        "retrieval_traces",
        "injections",
        "jobs",
        "jobs_dlq",
        "config",
      ]) {
        expect(tables).toContain(expected);
      }
      // FTS5 shadow tables imply l1_facts_fts exists as a virtual table.
      const virtual = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='l1_facts_fts'")
        .all();
      expect(virtual).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("fts trigram tokenizes chinese", () => {
    const db = makeDb();
    try {
      db.prepare("INSERT INTO l1_facts_fts (fact_id, content) VALUES (?, ?)").run(
        "fact-1",
        "用户偏好 pnpm 而非 npm",
      );
      // trigram requires >= 3 codepoints per token; 4-char query hits.
      const hits = db
        .prepare("SELECT fact_id FROM l1_facts_fts WHERE l1_facts_fts MATCH ?")
        .all("用户偏好") as Array<{ fact_id: string }>;
      expect(hits.map((h) => h.fact_id)).toContain("fact-1");
      // 2-char queries cannot use the trigram index: LIKE is the documented
      // fallback (see retrieval/keyword.ts).
      const likeHits = db
        .prepare("SELECT fact_id FROM l1_facts_fts WHERE content LIKE ?")
        .all("%偏好%") as Array<{ fact_id: string }>;
      expect(likeHits.map((h) => h.fact_id)).toContain("fact-1");
    } finally {
      db.close();
    }
  });

  it("vec table factory creates per-model table", () => {
    const db = makeDb();
    try {
      const name = ensureVecTable(db, "local", "e5-small", 384);
      expect(name).toBe("vec_facts_local_e5-small_384");
      expect(listTables(db)).toContain(vecTableName("local", "e5-small", 384));
      // insert + query round trip
      const vector = new Float32Array(384).fill(0.01);
      db.prepare(`INSERT INTO "${name}" (fact_id, embedding) VALUES (?, ?)`).run(
        "fact-9",
        Buffer.from(vector.buffer),
      );
      const rows = db
        .prepare(`SELECT fact_id, distance FROM "${name}" WHERE embedding MATCH ? AND k = 5`)
        .all(Buffer.from(vector.buffer)) as Array<{ fact_id: string; distance: number }>;
      expect(rows.map((r) => r.fact_id)).toContain("fact-9");
      // injection guard: non-whitelisted characters are rejected
      expect(() => ensureVecTable(db, "local", "e5 small'; DROP TABLE x; --", 384)).toThrow();
      expect(() => ensureVecTable(db, "local", "e5-small", 0)).toThrow();
    } finally {
      db.close();
    }
  });

  it("foreign keys enforced", () => {
    const db = makeDb();
    try {
      db.prepare("INSERT INTO services (id, name, created_at) VALUES (?, ?, ?)").run(
        "svc-1",
        "work",
        "2026-08-11T00:00:00.000Z",
      );
      db.prepare("INSERT INTO spaces (id, service_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "space-1",
        "svc-1",
        "default",
        "2026-08-11T00:00:00.000Z",
      );
      db.prepare(
        "INSERT INTO l0_messages (id, session_id, turn, role, content, redacted, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("m-1", null, 1, "user", "hello", 0, 1, "2026-08-11T00:00:00.000Z");
      db.prepare(
        "INSERT INTO l1_facts (id, space_id, agent_id, content, content_hash, status, confidence, half_life_days, access_count, last_accessed_at, source_message_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 'active', 1.0, 30, 0, ?, 'm-1', ?, ?)",
      ).run(
        "f-1",
        "space-1",
        "hello",
        "hash-1",
        "2026-08-11T00:00:00.000Z",
        "2026-08-11T00:00:00.000Z",
        "2026-08-11T00:00:00.000Z",
      );
      expect(() => db.prepare("DELETE FROM l0_messages WHERE id = 'm-1'").run()).toThrow(
        /FOREIGN KEY constraint failed/i,
      );
    } finally {
      db.close();
    }
  });
});
