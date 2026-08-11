import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactsDao } from "../../src/dao/l1.js";
import { openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { type Scope, ScopeRequiredError, validateScope } from "../../src/scope/context.js";

const tempDirs: string[] = [];

function makeDb(): ReturnType<typeof openDatabase> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-scope-"));
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

function seedTenants(db: ReturnType<typeof openDatabase>): void {
  const now = "2026-08-11T00:00:00.000Z";
  db.prepare("INSERT INTO services (id, name, created_at) VALUES (?, ?, ?)").run(
    "svc-1",
    "work",
    now,
  );
  for (const space of ["space-a", "space-b"]) {
    db.prepare("INSERT INTO spaces (id, service_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      space,
      "svc-1",
      space,
      now,
    );
  }
  db.prepare("INSERT INTO agents (id, space_id, kind, name) VALUES (?, ?, ?, ?)").run(
    "agent-1",
    "space-a",
    "claude-code",
    "Claude Code",
  );
}

describe("scope guard", () => {
  it("dao requires scope", () => {
    const db = makeDb();
    try {
      seedTenants(db);
      expect(() => new FactsDao(db, undefined as unknown as Scope)).toThrow(ScopeRequiredError);
      expect(() => validateScope(undefined as unknown as Scope)).toThrow(ScopeRequiredError);
    } finally {
      db.close();
    }
  });

  it("cross-space isolation (AC-11)", () => {
    const db = makeDb();
    try {
      seedTenants(db);
      const daoA = new FactsDao(db, { serviceId: "svc-1", spaceId: "space-a" });
      for (let i = 0; i < 3; i += 1) {
        daoA.create({ content: `fact A-${i}` });
      }
      const daoB = new FactsDao(db, { serviceId: "svc-1", spaceId: "space-b" });
      expect(daoB.list()).toEqual([]);
      expect(daoB.list({ includeAllStatuses: true })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("agent null means space-shared", () => {
    const db = makeDb();
    try {
      seedTenants(db);
      const spaceDao = new FactsDao(db, { serviceId: "svc-1", spaceId: "space-a" });
      const shared = spaceDao.create({ content: "space shared fact" });
      const scoped = spaceDao.create({ content: "agent scoped fact", agentId: "agent-1" });

      // space-wide scope sees both
      const all = spaceDao.list().map((f) => f.id);
      expect(all).toContain(shared.id);
      expect(all).toContain(scoped.id);

      // a different agent in the same space sees shared but not scoped
      db.prepare("INSERT INTO agents (id, space_id, kind, name) VALUES (?, ?, ?, ?)").run(
        "agent-2",
        "space-a",
        "codex",
        "Codex",
      );
      const otherAgentDao = new FactsDao(db, {
        serviceId: "svc-1",
        spaceId: "space-a",
        agentId: "agent-2",
      });
      const otherIds = otherAgentDao.list().map((f) => f.id);
      expect(otherIds).toContain(shared.id);
      expect(otherIds).not.toContain(scoped.id);

      // the owning agent sees both
      const ownerDao = new FactsDao(db, {
        serviceId: "svc-1",
        spaceId: "space-a",
        agentId: "agent-1",
      });
      const ownerIds = ownerDao.list().map((f) => f.id);
      expect(ownerIds).toContain(shared.id);
      expect(ownerIds).toContain(scoped.id);
    } finally {
      db.close();
    }
  });
});
