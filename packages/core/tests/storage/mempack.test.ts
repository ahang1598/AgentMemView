import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactsDao } from "../../src/dao/l1.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import type { Scope } from "../../src/scope/context.js";
import { exportMempack, importMempack } from "../../src/storage/mempack.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeDb(dir: string): AgentMemViewDatabase {
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("mempack full (M4-08, AC-10)", () => {
  it("round-trip preserves facts/lineage/config/sessions", async () => {
    const sourceDir = makeDir("agentmemview-packfull-src-");
    const db = makeDb(sourceDir);
    const tenants = new TenantsDao(db);
    const svc = tenants.createService({ name: "work" });
    const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
    const agent = tenants.createAgent({ spaceId: space.id, kind: "codex", name: "Codex" });
    db.prepare(
      "INSERT INTO sessions (id, agent_id, external_id, started_at, meta_json) VALUES (?, ?, 'ext-1', ?, '{}')",
    ).run("sess-1", agent.id, new Date().toISOString());
    const scope: Scope = { serviceId: svc.id, spaceId: space.id };
    const dao = new FactsDao(db, scope);
    const v1 = dao.create({ content: "第一版事实" });
    dao.update(v1.id, { content: "第二版事实" });
    dao.create({ content: "独立事实" });
    db.prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)").run(
      "decayHalfLifeDays",
      "45",
    );

    const packPath = path.join(sourceDir, "full.mempack");
    const manifest = await exportMempack(db, packPath, {
      embedding: { provider: "local", model: "e5-small", dims: 384 },
    });
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.counts.l1Facts).toBe(3);

    const targetDir = makeDir("agentmemview-packfull-dst-");
    const targetDbPath = path.join(targetDir, "agentmemview.db");
    await importMempack(packPath, targetDbPath);
    const target = openDatabase(targetDbPath);
    openDbs.push(target);

    // facts + hashes
    const sourceRows = db
      .prepare("SELECT content_hash FROM l1_facts ORDER BY content_hash")
      .all() as Array<{ content_hash: string }>;
    const targetRows = target
      .prepare("SELECT content_hash FROM l1_facts ORDER BY content_hash")
      .all() as Array<{ content_hash: string }>;
    expect(targetRows).toEqual(sourceRows);

    // lineage chain preserved
    const targetDao = new FactsDao(target, scope);
    const chain = targetDao.lineage(v1.id).map((f) => f.content);
    expect(chain).toEqual(["第一版事实", "第二版事实"]);

    // config preserved
    const config = target
      .prepare("SELECT value_json FROM config WHERE key = 'decayHalfLifeDays'")
      .get() as {
      value_json: string;
    };
    expect(JSON.parse(config.value_json)).toBe(45);

    // sessions preserved
    const sessions = target.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    expect(sessions.n).toBe(1);
  });

  it("import validates manifest schema version", async () => {
    const sourceDir = makeDir("agentmemview-packver-src-");
    const db = makeDb(sourceDir);
    const packPath = path.join(sourceDir, "v.mempack");
    await exportMempack(db, packPath, {
      embedding: { provider: "local", model: "e5-small", dims: 384 },
    });
    const targetDir = makeDir("agentmemview-packver-dst-");
    // corrupted pack: unknown manifest format
    const corruptPath = path.join(sourceDir, "corrupt.mempack");
    const { packTarGz } = await import("../../src/storage/tar.js");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      corruptPath,
      packTarGz([
        {
          name: "manifest.json",
          data: Buffer.from(JSON.stringify({ format: "unknown-format/9" }), "utf8"),
        },
        { name: "agentmemview.db", data: Buffer.from([]) },
      ]),
    );
    await expect(importMempack(corruptPath, path.join(targetDir, "x.db"))).rejects.toThrow(
      /unsupported/i,
    );
    expect(existsSync(path.join(targetDir, "x.db"))).toBe(false);
  });
});
