import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactsDao } from "../../src/dao/l1.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import type { Scope } from "../../src/scope/context.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  db: AgentMemViewDatabase;
  scope: Scope;
  clockMs: { value: number };
  makeDao: () => FactsDao;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-l1-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  const scope: Scope = { serviceId: svc.id, spaceId: space.id };
  const clockMs = { value: Date.parse("2026-08-11T00:00:00.000Z") };
  const makeDao = () => new FactsDao(db, scope, () => clockMs.value);
  return { db, scope, clockMs, makeDao };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("FactsDao lifecycle", () => {
  it("create dedupes by content_hash in 5-min window", () => {
    const { makeDao, clockMs } = makeFixture();
    const dao = makeDao();
    const first = dao.create({ content: "用户偏好 pnpm" });
    expect(first.deduped).toBe(false);
    // 4 minutes later: same content dedupes
    clockMs.value += 4 * 60_000;
    const again = dao.create({ content: "用户偏好 pnpm" });
    expect(again.deduped).toBe(true);
    expect(again.id).toBe(first.id);
    // different content does not dedupe
    const other = dao.create({ content: "用户偏好 vim" });
    expect(other.deduped).toBe(false);
    // after the window closes a new row is created
    clockMs.value += 2 * 60_000;
    const late = dao.create({ content: "用户偏好 pnpm" });
    expect(late.deduped).toBe(false);
    expect(late.id).not.toBe(first.id);
  });

  it("update supersedes with lineage (AC-05)", () => {
    const { makeDao } = makeFixture();
    const dao = makeDao();
    const v1 = dao.create({ content: "部署在 AWS" });
    const v2 = dao.update(v1.id, { content: "部署在阿里云" });

    const old = dao.get(v1.id);
    const fresh = dao.get(v2.id);
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe(v2.id);
    expect(fresh?.status).toBe("active");
    expect(fresh?.content).toBe("部署在阿里云");

    const v3 = dao.update(v2.id, { content: "部署在腾讯云" });
    const chain = dao.lineage(v3.id).map((f) => f.content);
    expect(chain).toEqual(["部署在 AWS", "部署在阿里云", "部署在腾讯云"]);
    // lineage from the oldest id returns the same chain
    expect(dao.lineage(v1.id).map((f) => f.id)).toEqual(dao.lineage(v3.id).map((f) => f.id));
  });

  it("pin exempts from decay; forget sets forgotten and can recover", () => {
    const { makeDao } = makeFixture();
    const dao = makeDao();
    const fact = dao.create({ content: "重要约定" });

    const pinned = dao.pin(fact.id, true);
    expect(pinned.pinned).toBe(true);

    const forgotten = dao.forget(fact.id);
    expect(forgotten.status).toBe("forgotten");
    // forgotten rows leave the default active listing
    expect(dao.list().map((f) => f.id)).not.toContain(fact.id);
    expect(dao.list({ includeAllStatuses: true }).map((f) => f.id)).toContain(fact.id);

    const recovered = dao.recover(fact.id);
    expect(recovered.status).toBe("active");
    expect(dao.list().map((f) => f.id)).toContain(fact.id);
  });

  it("access touch updates count and timestamp", () => {
    const { makeDao, clockMs } = makeFixture();
    const dao = makeDao();
    const fact = dao.create({ content: "被引用的事实" });
    clockMs.value += 60_000;
    const touched = dao.touch(fact.id);
    expect(touched.accessCount).toBe(1);
    expect(Date.parse(touched.lastAccessedAt)).toBe(clockMs.value);
    dao.touch(fact.id);
    expect(dao.get(fact.id)?.accessCount).toBe(2);
  });

  it("update keeps FTS index current", () => {
    const { db, makeDao } = makeFixture();
    const dao = makeDao();
    const v1 = dao.create({ content: "检索旧版本内容" });
    dao.update(v1.id, { content: "检索新版本内容" });
    const hits = db
      .prepare("SELECT fact_id FROM l1_facts_fts WHERE l1_facts_fts MATCH ?")
      .all("检索新版本内容") as Array<{ fact_id: string }>;
    expect(hits.some((h) => h.fact_id !== v1.id)).toBe(true);
    const stale = db
      .prepare("SELECT fact_id FROM l1_facts_fts WHERE l1_facts_fts MATCH ?")
      .all("检索旧版本内容") as Array<{ fact_id: string }>;
    expect(stale).toHaveLength(0);
  });
});
