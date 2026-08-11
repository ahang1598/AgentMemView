import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentMemViewDatabase,
  exportMempack,
  FactsDao,
  importMempack,
  MockEmbeddingProvider,
  migrate,
  openDatabase,
  TenantsDao,
} from "@agentmemview/core";
import { afterEach, describe, expect, it } from "vitest";

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

describe(".mempack export/import (AC-10 engine part)", () => {
  it("export then import round-trips facts", async () => {
    const sourceDir = makeDir("agentmemview-pack-src-");
    const db = makeDb(sourceDir);
    const tenants = new TenantsDao(db);
    const svc = tenants.createService({ name: "work" });
    const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
    const dao = new FactsDao(db, { serviceId: svc.id, spaceId: space.id });
    const hashes: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      hashes.push(dao.create({ content: `导出往返事实第 ${i} 条` }).contentHash);
    }

    const packPath = path.join(sourceDir, "backup.mempack");
    const manifest = await exportMempack(db, packPath, {
      embedding: { provider: "mock", model: "hash-projection", dims: 384 },
    });
    expect(existsSync(packPath)).toBe(true);
    expect(manifest.format).toBe("agentmemview-mempack/1");
    expect(manifest.schemaVersions).toContain("0001_init");
    expect(manifest.embeddings).toHaveLength(1);
    expect(manifest.counts.l1Facts).toBe(10);

    const targetDir = makeDir("agentmemview-pack-dst-");
    const targetDbPath = path.join(targetDir, "agentmemview.db");
    const report = await importMempack(packPath, targetDbPath);
    expect(report.pendingRebuild).toEqual([]);

    const target = openDatabase(targetDbPath);
    openDbs.push(target);
    migrate(target);
    const rows = target.prepare("SELECT content_hash FROM l1_facts").all() as Array<{
      content_hash: string;
    }>;
    expect(rows.map((r) => r.content_hash).sort()).toEqual([...hashes].sort());
  });

  it("import with dim mismatch marks pending-rebuild, does not fail", async () => {
    const sourceDir = makeDir("agentmemview-pack-src2-");
    const db = makeDb(sourceDir);
    const tenants = new TenantsDao(db);
    const svc = tenants.createService({ name: "work" });
    const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
    const dao = new FactsDao(db, { serviceId: svc.id, spaceId: space.id });
    dao.create({ content: "维度不匹配测试事实" });
    // seed a vec table of a triple the target environment does not support
    const provider = new MockEmbeddingProvider(384);
    db.exec(
      'CREATE VIRTUAL TABLE "vec_facts_mock_hash-projection_384" USING vec0(fact_id TEXT PRIMARY KEY, embedding FLOAT[384])',
    );
    const [vector] = await provider.embed(["维度不匹配测试事实"]);
    db.prepare(
      'INSERT INTO "vec_facts_mock_hash-projection_384" (fact_id, embedding) VALUES (?, ?)',
    ).run("x", Buffer.from(new Float32Array(vector ?? []).buffer));

    const packPath = path.join(sourceDir, "backup.mempack");
    await exportMempack(db, packPath, {
      embedding: { provider: "mock", model: "hash-projection", dims: 384 },
    });

    const targetDir = makeDir("agentmemview-pack-dst2-");
    const targetDbPath = path.join(targetDir, "agentmemview.db");
    // import with a different active triple → vec data flagged, not rejected
    const report = await importMempack(packPath, targetDbPath, {
      activeEmbedding: { provider: "local", model: "e5-small", dims: 384 },
    });
    expect(report.pendingRebuild.length).toBeGreaterThan(0);
    expect(report.pendingRebuild[0]).toContain("mock_hash-projection");
    const target = openDatabase(targetDbPath);
    openDbs.push(target);
    const count = (target.prepare("SELECT COUNT(*) AS n FROM l1_facts").get() as { n: number }).n;
    expect(count).toBe(1);
  });
});
