import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactsDao } from "../../src/dao/l1.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { EventBus } from "../../src/events/bus.js";
import { runDecayScan } from "../../src/refine/decayScan.js";
import type { Scope } from "../../src/scope/context.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  db: AgentMemViewDatabase;
  scope: Scope;
  bus: EventBus;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-decay-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  return { db, scope: { serviceId: svc.id, spaceId: space.id }, bus: new EventBus(db) };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("decay scan (M4-05)", () => {
  it("marks forgotten below threshold and emits event", () => {
    const { db, scope, bus } = makeFixture();
    const clockMs = { value: Date.parse("2026-08-11T00:00:00.000Z") };
    const dao = new FactsDao(db, scope, () => clockMs.value);
    // accessed 90 days ago with 30-day half-life → factor 0.125
    const stale = dao.create({ content: "陈旧的事实", halfLifeDays: 30 });
    db.prepare("UPDATE l1_facts SET last_accessed_at = ? WHERE id = ?").run(
      new Date(clockMs.value - 90 * 86_400_000).toISOString(),
      stale.id,
    );
    // recently accessed → survives
    const fresh = dao.create({ content: "新鲜的事实" });
    const result = runDecayScan(db, { bus, nowMs: () => clockMs.value, threshold: 0.2 });
    expect(result.forgotten).toBe(1);
    expect(dao.get(stale.id)?.status).toBe("forgotten");
    expect(dao.get(fresh.id)?.status).toBe("active");
    const events = bus.replay(0).filter((e) => e.kind === "decay.forgotten");
    expect(events).toHaveLength(1);
  });

  it("pinned facts untouched", () => {
    const { db, scope, bus } = makeFixture();
    const clockMs = { value: Date.parse("2026-08-11T00:00:00.000Z") };
    const dao = new FactsDao(db, scope, () => clockMs.value);
    const pinned = dao.create({ content: "钉住的事实", halfLifeDays: 1, pinned: true });
    db.prepare("UPDATE l1_facts SET last_accessed_at = ? WHERE id = ?").run(
      new Date(clockMs.value - 365 * 86_400_000).toISOString(),
      pinned.id,
    );
    const result = runDecayScan(db, { bus, nowMs: () => clockMs.value });
    expect(result.forgotten).toBe(0);
    expect(dao.get(pinned.id)?.status).toBe("active");
  });

  it("dry-run reports candidates only", () => {
    const { db, scope, bus } = makeFixture();
    const clockMs = { value: Date.parse("2026-08-11T00:00:00.000Z") };
    const dao = new FactsDao(db, scope, () => clockMs.value);
    const stale = dao.create({ content: "候选遗忘", halfLifeDays: 1 });
    db.prepare("UPDATE l1_facts SET last_accessed_at = ? WHERE id = ?").run(
      new Date(clockMs.value - 30 * 86_400_000).toISOString(),
      stale.id,
    );
    const result = runDecayScan(db, { bus, nowMs: () => clockMs.value, dryRun: true });
    expect(result.candidates.map((c) => c.id)).toContain(stale.id);
    expect(dao.get(stale.id)?.status).toBe("active");
  });
});
