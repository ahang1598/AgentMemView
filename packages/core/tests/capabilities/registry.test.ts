import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { createHttpApp } from "../../src/http/app.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeApp(): ReturnType<typeof createHttpApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-registry-"));
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

async function capabilities(app: ReturnType<typeof createHttpApp>) {
  const res = await app.request("/api/v1/capabilities");
  return ((await res.json()) as { items: Array<Record<string, unknown>> }).items;
}

describe("capability registry (M4-09)", () => {
  it("AC-08: PUT config enabling llm flips state to active without restart", async () => {
    const app = makeApp();
    let items = await capabilities(app);
    expect(items.find((i) => i.key === "llm-gateway")?.state).toBe("off");
    await app.request("/api/v1/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        "capability.llm-gateway": { baseUrl: "http://gw", apiKey: "k", model: "m" },
      }),
    });
    items = await capabilities(app);
    expect(items.find((i) => i.key === "llm-gateway")?.state).toBe("active");
  });

  it("bad config → state error with field message, main path unaffected", async () => {
    const app = makeApp();
    await app.request("/api/v1/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "capability.llm-gateway": { baseUrl: "http://gw", apiKey: "" } }),
    });
    const items = await capabilities(app);
    const llm = items.find((i) => i.key === "llm-gateway");
    expect(llm?.state).toBe("error");
    expect(String(llm?.error)).toContain("apiKey");
    // main path unaffected: health + memories still work
    expect((await app.request("/api/v1/health")).status).toBe(200);
  });

  it("GET /capabilities returns all six entries with configKeys/guide", async () => {
    const app = makeApp();
    const items = await capabilities(app);
    const keys = items.map((i) => i.key);
    expect(keys).toEqual([
      "llm-gateway",
      "embedding-api",
      "sidecar",
      "local-embedding",
      "cloud-vector",
      "reranker-api",
    ]);
    expect(items.find((i) => i.key === "llm-gateway")?.configKeys).toEqual([
      "capability.llm-gateway",
    ]);
    expect(items.find((i) => i.key === "sidecar")?.guide).toContain("uv tool install");
  });

  it("GET /jobs exposes queue state", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/jobs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; deadLetters: number };
    expect(body.items).toEqual([]);
    expect(body.deadLetters).toBe(0);
  });
});
