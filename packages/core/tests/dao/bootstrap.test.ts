import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapDefaultTenants, TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeDb(): AgentMemViewDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-bootstrap-"));
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

describe("bootstrapDefaultTenants (first-run default space)", () => {
  it("fresh db gets a default space; idempotent on re-run", () => {
    const db = makeDb();
    const first = bootstrapDefaultTenants(db);
    expect(first.spaceId.length).toBeGreaterThan(0);
    const dao = new TenantsDao(db);
    const spaces = dao.listSpaces({});
    expect(spaces.items.map((s) => s.name)).toContain("default");
    // second run must not duplicate
    const second = bootstrapDefaultTenants(db);
    expect(second.spaceId).toBe(first.spaceId);
    expect(new TenantsDao(db).listSpaces({}).items).toHaveLength(1);
  });

  it("keeps user-created spaces untouched", () => {
    const db = makeDb();
    const dao = new TenantsDao(db);
    const svc = dao.createService({ name: "mine" });
    const space = dao.createSpace({ serviceId: svc.id, name: "work" });
    const out = bootstrapDefaultTenants(db);
    expect(out.spaceId).toBe(space.id);
    expect(dao.listSpaces({}).items).toHaveLength(1);
  });
});
