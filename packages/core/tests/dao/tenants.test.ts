import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../../src/dao/errors.js";
import { FactsDao } from "../../src/dao/l1.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";

const tempDirs: string[] = [];

function makeDb(): ReturnType<typeof openDatabase> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-tenants-"));
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

describe("TenantsDao", () => {
  it("service crud flow: create → get → list → patch → delete", () => {
    const db = makeDb();
    try {
      const dao = new TenantsDao(db);
      const svc = dao.createService({ name: "work" });
      expect(dao.getService(svc.id).name).toBe("work");

      dao.createService({ name: "personal" });
      const page1 = dao.listServices({ limit: 1 });
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = dao.listServices({ limit: 1, cursor: page1.nextCursor ?? undefined });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
      expect(page2.nextCursor).toBeNull();

      const patched = dao.patchService(svc.id, { name: "work-renamed" });
      expect(patched.name).toBe("work-renamed");

      dao.deleteService(svc.id);
      expect(() => dao.getService(svc.id)).toThrow(NotFoundError);
    } finally {
      db.close();
    }
  });

  it("get/patch/delete missing rows throw NotFoundError", () => {
    const db = makeDb();
    try {
      const dao = new TenantsDao(db);
      expect(() => dao.getService("nope")).toThrow(NotFoundError);
      expect(() => dao.patchService("nope", { name: "x" })).toThrow(NotFoundError);
      expect(() => dao.deleteSpace("nope", { force: true })).toThrow(NotFoundError);
      expect(() => dao.deleteAgent("nope")).toThrow(NotFoundError);
    } finally {
      db.close();
    }
  });

  it("space and agent crud flow", () => {
    const db = makeDb();
    try {
      const dao = new TenantsDao(db);
      const svc = dao.createService({ name: "work" });
      const space = dao.createSpace({ serviceId: svc.id, name: "default" });
      const agent = dao.createAgent({ spaceId: space.id, kind: "claude-code", name: "CC" });

      expect(dao.getSpace(space.id).name).toBe("default");
      expect(dao.listSpaces({ serviceId: svc.id }).items.map((s) => s.id)).toContain(space.id);
      expect(dao.listAgents({ spaceId: space.id }).items.map((a) => a.id)).toContain(agent.id);

      expect(dao.patchSpace(space.id, { name: "renamed" }).name).toBe("renamed");
      expect(dao.patchAgent(agent.id, { name: "CC2" }).name).toBe("CC2");

      dao.deleteAgent(agent.id);
      expect(() => dao.getAgent(agent.id)).toThrow(NotFoundError);
    } finally {
      db.close();
    }
  });

  it("delete space without force → ConflictError with children count", () => {
    const db = makeDb();
    try {
      const dao = new TenantsDao(db);
      const svc = dao.createService({ name: "work" });
      const space = dao.createSpace({ serviceId: svc.id, name: "default" });
      dao.createAgent({ spaceId: space.id, kind: "codex", name: "Codex" });

      try {
        dao.deleteSpace(space.id, {});
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        expect((err as ConflictError).childrenCount).toBeGreaterThanOrEqual(1);
      }
    } finally {
      db.close();
    }
  });

  it("delete space with force cascades child rows", () => {
    const db = makeDb();
    try {
      const dao = new TenantsDao(db);
      const svc = dao.createService({ name: "work" });
      const space = dao.createSpace({ serviceId: svc.id, name: "default" });
      const agent = dao.createAgent({ spaceId: space.id, kind: "codex", name: "Codex" });
      const facts = new FactsDao(db, { serviceId: svc.id, spaceId: space.id });
      facts.create({ content: "will vanish", agentId: agent.id });

      dao.deleteSpace(space.id, { force: true });
      expect(() => dao.getSpace(space.id)).toThrow(NotFoundError);
      expect((db.prepare("SELECT COUNT(*) AS n FROM l1_facts").get() as { n: number }).n).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n).toBe(0);
    } finally {
      db.close();
    }
  });
});
