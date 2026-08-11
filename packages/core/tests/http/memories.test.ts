import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TenantsDao } from "../../src/dao/tenants.js";
import type { AgentMemViewDatabase } from "../../src/db/database.js";
import { openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { createHttpApp } from "../../src/http/app.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  app: ReturnType<typeof createHttpApp>;
  db: AgentMemViewDatabase;
  serviceId: string;
  spaceId: string;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function makeFixture(): Promise<Fixture> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-http-memories-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  return { app: createHttpApp(db), db, serviceId: svc.id, spaceId: space.id };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function createMemory(
  app: ReturnType<typeof createHttpApp>,
  spaceId: string,
  content: string,
): Promise<Record<string, unknown>> {
  const res = await app.request("/api/v1/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spaceId, content }),
  });
  expect(res.status).toBe(201);
  return json(res);
}

describe("memories REST (Spec section 11)", () => {
  it("POST 201 + fact_id; GET lineage after PATCH supersede", async () => {
    const { app, spaceId } = await makeFixture();
    const created = await createMemory(app, spaceId, "部署在 AWS");
    expect(typeof created.id).toBe("string");

    const patched = await app.request(`/api/v1/memories/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "部署在阿里云" }),
    });
    expect(patched.status).toBe(200);
    const superseding = await json(patched);
    expect(superseding.content).toBe("部署在阿里云");

    const lineageRes = await app.request(`/api/v1/memories/${created.id}/lineage`);
    expect(lineageRes.status).toBe(200);
    const lineage = (await json(lineageRes)) as unknown as { chain: Array<{ content: string }> };
    expect(lineage.chain.map((f) => f.content)).toEqual(["部署在 AWS", "部署在阿里云"]);
  });

  it("POST /search returns results + traceId; GET /traces/:id has six stages", async () => {
    const { app, spaceId } = await makeFixture();
    await createMemory(app, spaceId, "用户偏好 pnpm 而非 npm 包管理器");

    const searchRes = await app.request("/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "pnpm 包管理器偏好", spaceId }),
    });
    expect(searchRes.status).toBe(200);
    const search = await json(searchRes);
    expect(Array.isArray(search.results)).toBe(true);
    expect((search.results as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(typeof search.traceId).toBe("string");

    const traceRes = await app.request(`/api/v1/traces/${search.traceId}`);
    expect(traceRes.status).toBe(200);
    const trace = await json(traceRes);
    const stages = trace.stages as Array<{ stage: string }>;
    expect(stages.map((s) => s.stage)).toEqual([
      "prefilter",
      "fts",
      "vec",
      "rrf",
      "decay",
      "final",
    ]);

    const listRes = await app.request("/api/v1/traces");
    expect(listRes.status).toBe(200);
    const listed = await json(listRes);
    expect((listed.items as Array<{ id: string }>).some((t) => t.id === search.traceId)).toBe(true);
  });

  it("search with foreign space scope → 200 empty (AC-11)", async () => {
    const { app, db, serviceId, spaceId } = await makeFixture();
    await createMemory(app, spaceId, "空间 A 的机密事实记录");
    const tenants = new TenantsDao(db);
    const otherSpace = tenants.createSpace({ serviceId, name: "other" });

    const res = await app.request("/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "机密事实", spaceId: otherSpace.id }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.results).toEqual([]);
  });

  it("GET /memories lists with scope; unknown id → 404", async () => {
    const { app, spaceId } = await makeFixture();
    await createMemory(app, spaceId, "可浏览的事实内容");
    const listRes = await app.request(`/api/v1/memories?spaceId=${spaceId}`);
    expect(listRes.status).toBe(200);
    const listed = await json(listRes);
    expect((listed.items as unknown[]).length).toBe(1);

    const missing = await app.request(`/api/v1/memories/${spaceId}/lineage`);
    expect(missing.status).toBe(404);
  });

  it("POST /memories without space → 400", async () => {
    const { app } = await makeFixture();
    const res = await app.request("/api/v1/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "缺少空间" }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("validation");
  });
});
