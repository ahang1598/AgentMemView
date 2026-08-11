import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { MockEmbeddingProvider } from "../../src/embedding/mock.js";
import { runRetrievalEval } from "../../src/retrieval/eval.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeDb(): AgentMemViewDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-eval-"));
  tempDirs.push(dir);
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

describe("synthetic retrieval eval (baseline gate)", () => {
  it("eval synthetic R@5 >= 0.85", async () => {
    const db = makeDb();
    const tenants = new TenantsDao(db);
    const svc = tenants.createService({ name: "eval" });
    const space = tenants.createSpace({ serviceId: svc.id, name: "eval" });
    const report = await runRetrievalEval({
      db,
      scope: { serviceId: svc.id, spaceId: space.id },
      provider: new MockEmbeddingProvider(),
    });
    expect(report.total).toBeGreaterThanOrEqual(200);
    expect(report.queries).toBe(40);
    expect(report.recallAt5).toBeGreaterThanOrEqual(0.85);
    expect(report.recallAt10).toBeGreaterThanOrEqual(report.recallAt5);
    expect(report.mrr).toBeGreaterThan(0);
  }, 60_000);
});
