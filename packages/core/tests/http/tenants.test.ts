import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMemViewDatabase } from "../../src/db/database.js";
import { openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { createHttpApp } from "../../src/http/app.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeApp(): ReturnType<typeof createHttpApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-http-tenants-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  return createHttpApp(db);
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("tenant REST routes", () => {
  it("services crud over http", async () => {
    const app = makeApp();
    const created = await app.request("/api/v1/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "work" }),
    });
    expect(created.status).toBe(201);
    const svc = await json(created);
    expect(typeof svc.id).toBe("string");

    const listed = await app.request("/api/v1/services");
    expect(listed.status).toBe(200);
    expect((await json(listed)).items).toBeInstanceOf(Array);

    const patched = await app.request(`/api/v1/services/${svc.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "work2" }),
    });
    expect(patched.status).toBe(200);
    expect((await json(patched)).name).toBe("work2");

    const deleted = await app.request(`/api/v1/services/${svc.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);

    const missing = await app.request(`/api/v1/services/${svc.id}`);
    expect(missing.status).toBe(404);
  });

  it("invalid body → 400 with field path", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("validation");
  });

  it("delete space without force → 409 with children count", async () => {
    const app = makeApp();
    const svc = await json(
      await app.request("/api/v1/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "work" }),
      }),
    );
    const space = await json(
      await app.request("/api/v1/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: svc.id, name: "default" }),
      }),
    );
    await app.request("/api/v1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: space.id, kind: "codex", name: "Codex" }),
    });

    const refused = await app.request(`/api/v1/spaces/${space.id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    const refusedBody = await json(refused);
    expect(refusedBody.error).toBe("conflict");
    expect(Number(refusedBody.childrenCount)).toBeGreaterThanOrEqual(1);

    const forced = await app.request(`/api/v1/spaces/${space.id}?force=1`, {
      method: "DELETE",
    });
    expect(forced.status).toBe(204);
  });

  it("agents crud over http", async () => {
    const app = makeApp();
    const svc = await json(
      await app.request("/api/v1/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "work" }),
      }),
    );
    const space = await json(
      await app.request("/api/v1/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: svc.id, name: "default" }),
      }),
    );
    const created = await app.request("/api/v1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: space.id, kind: "claude-code", name: "CC" }),
    });
    expect(created.status).toBe(201);
    const agent = await json(created);
    const got = await app.request(`/api/v1/agents/${agent.id}`);
    expect(got.status).toBe(200);
    const deleted = await app.request(`/api/v1/agents/${agent.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
  });
});
