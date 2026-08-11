import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactsDao } from "../../src/dao/l1.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { MockEmbeddingProvider } from "../../src/embedding/mock.js";
import { EventBus } from "../../src/events/bus.js";
import { ebbinghausFactor } from "../../src/retrieval/decay.js";
import { RetrievalEngine } from "../../src/retrieval/engine.js";
import { rrf } from "../../src/retrieval/rrf.js";
import type { Scope } from "../../src/scope/context.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  db: AgentMemViewDatabase;
  scope: Scope;
  spaceId: string;
  clockMs: { value: number };
  makeFactsDao: () => FactsDao;
  makeEngine: () => RetrievalEngine;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-retrieval-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  const scope: Scope = { serviceId: svc.id, spaceId: space.id };
  const clockMs = { value: Date.parse("2026-08-11T00:00:00.000Z") };
  const makeFactsDao = () => new FactsDao(db, scope, () => clockMs.value);
  const makeEngine = () =>
    new RetrievalEngine({
      db,
      scope,
      provider: new MockEmbeddingProvider(),
      bus: new EventBus(db),
      nowMs: () => clockMs.value,
    });
  return { db, scope, spaceId: space.id, clockMs, makeFactsDao, makeEngine };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("retrieval primitives", () => {
  it("rrf fuses two channels", () => {
    const fused = rrf(
      [
        [
          { id: "a", rank: 1 },
          { id: "b", rank: 2 },
        ],
        [
          { id: "b", rank: 1 },
          { id: "c", rank: 2 },
        ],
      ],
      60,
    );
    // hand-computed: a=1/61, b=1/62+1/61, c=1/62
    const scores = new Map(fused.map((f) => [f.id, f.score]));
    expect(scores.get("b")).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(scores.get("a")).toBeCloseTo(1 / 61, 12);
    expect(scores.get("c")).toBeCloseTo(1 / 62, 12);
    expect(fused.map((f) => f.id)).toEqual(["b", "a", "c"]);
  });

  it("decay halves at half life", () => {
    const now = Date.parse("2026-08-11T00:00:00.000Z");
    const factor = ebbinghausFactor({
      lastAccessedAt: new Date(now - 30 * 86_400_000).toISOString(),
      halfLifeDays: 30,
      pinned: false,
      nowMs: now,
    });
    expect(Math.abs(factor - 0.5)).toBeLessThan(1e-6);
    const pinned = ebbinghausFactor({
      lastAccessedAt: new Date(now - 300 * 86_400_000).toISOString(),
      halfLifeDays: 30,
      pinned: true,
      nowMs: now,
    });
    expect(pinned).toBe(1);
  });
});

describe("RetrievalEngine (six-stage pipeline)", () => {
  it("entity boost applies +0.1 when query matches entity", async () => {
    const { db, spaceId, makeFactsDao, makeEngine } = makeFixture();
    const dao = makeFactsDao();
    const boosted = dao.create({ content: "构建命令使用 pnpm build" });
    dao.create({ content: "另一条无关的备忘内容记录" });
    const entityId = "ent-1";
    db.prepare(
      "INSERT INTO entities (id, space_id, name, type, aliases_json) VALUES (?, ?, ?, ?, ?)",
    ).run(entityId, spaceId, "pnpm", "tool", "[]");
    db.prepare("INSERT INTO l1_fact_entities (fact_id, entity_id) VALUES (?, ?)").run(
      boosted.id,
      entityId,
    );
    const engine = makeEngine();
    const { results } = await engine.search("pnpm build 命令");
    const hit = results.find((r) => r.factId === boosted.id);
    expect(hit).toBeDefined();
    expect(hit?.entityBoost).toBe(true);
  });

  it("forgotten/superseded excluded", async () => {
    const { makeFactsDao, makeEngine } = makeFixture();
    const dao = makeFactsDao();
    const forgotten = dao.create({ content: "被遗忘的部署密钥配置说明" });
    dao.forget(forgotten.id);
    const v1 = dao.create({ content: "旧的服务器地址配置记录" });
    dao.update(v1.id, { content: "新的服务器地址配置记录" });
    const engine = makeEngine();
    const { results } = await engine.search("服务器地址配置");
    const ids = results.map((r) => r.factId);
    expect(ids).not.toContain(forgotten.id);
    expect(ids).not.toContain(v1.id);
  });

  it("search in foreign scope returns empty (AC-11)", async () => {
    const { db, makeFactsDao } = makeFixture();
    const dao = makeFactsDao();
    dao.create({ content: "空间内的秘密事实记录" });
    const tenants = new TenantsDao(db);
    const otherSpace = tenants.createSpace({
      serviceId: (tenants.listServices().items[0] as { id: string }).id,
      name: "other",
    });
    const engine = new RetrievalEngine({
      db,
      scope: { serviceId: "svc-x", spaceId: otherSpace.id },
      provider: new MockEmbeddingProvider(),
      nowMs: () => Date.now(),
    });
    const { results } = await engine.search("秘密事实");
    expect(results).toEqual([]);
  });

  it("trace records all six stages (AC-06)", async () => {
    const { db, makeFactsDao, makeEngine } = makeFixture();
    const dao = makeFactsDao();
    dao.create({ content: "用户偏好 pnpm 而非 npm 包管理器" });
    dao.create({ content: "项目使用 TypeScript 严格模式" });
    const engine = makeEngine();
    const { traceId, results } = await engine.search("pnpm 包管理器偏好");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const row = db.prepare("SELECT * FROM retrieval_traces WHERE id = ?").get(traceId) as {
      query: string;
      stages_json: string;
      results_json: string;
      latency_ms: number;
    };
    expect(row.query).toBe("pnpm 包管理器偏好");
    const stages = JSON.parse(row.stages_json) as Array<{ stage: string; candidates: string[] }>;
    expect(stages.map((s) => s.stage)).toEqual([
      "prefilter",
      "fts",
      "vec",
      "rrf",
      "decay",
      "final",
    ]);
    for (const stage of stages) {
      expect(Array.isArray(stage.candidates)).toBe(true);
    }
    expect(row.latency_ms).toBeGreaterThan(0);
    expect(JSON.parse(row.results_json)).toHaveLength(results.length);
  });
});
