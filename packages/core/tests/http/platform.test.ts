import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { createHttpApp } from "../../src/http/app.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeApp(): ReturnType<typeof createHttpApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-platform-"));
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

describe("platform endpoints (M3)", () => {
  it("dev/seed populates demo data once", async () => {
    const app = makeApp();
    const first = await app.request("/api/v1/dev/seed", { method: "POST" });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { seeded: boolean };
    expect(body.seeded).toBe(true);
    const second = await app.request("/api/v1/dev/seed", { method: "POST" });
    expect(((await second.json()) as { seeded: boolean }).seeded).toBe(false);
    const injections = (await (await app.request("/api/v1/injections")).json()) as {
      items: unknown[];
    };
    expect(injections.items.length).toBeGreaterThan(0);
  });

  it("config round-trip persists and reads back", async () => {
    const app = makeApp();
    const put = await app.request("/api/v1/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decayHalfLifeDays: 45 }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/v1/config");
    const config = (await get.json()) as Record<string, unknown>;
    expect(config.decayHalfLifeDays).toBe(45);
  });

  it("capabilities lists the locked five with state", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/capabilities");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ key: string; state: string }>;
    };
    const keys = body.items.map((i) => i.key);
    expect(keys).toContain("llm-gateway");
    expect(keys).toContain("embedding-api");
    expect(keys).toContain("local-embedding");
    expect(keys).toContain("sidecar");
    expect(keys).toContain("reranker");
    // configure llm-gateway → state flips to configured
    await app.request("/api/v1/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "capability.llm-gateway": { baseUrl: "x", apiKey: "y", model: "z" } }),
    });
    const after = (await (await app.request("/api/v1/capabilities")).json()) as {
      items: Array<{ key: string; state: string }>;
    };
    expect(after.items.find((i) => i.key === "llm-gateway")?.state).toBe("configured");
  });

  it("onboard/status detects files in AGENTMEMVIEW_HOME", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "agentmemview-home-"));
    tempDirs.push(home);
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "settings.json"), "{}", "utf8");
    const previous = process.env.AGENTMEMVIEW_HOME;
    process.env.AGENTMEMVIEW_HOME = home;
    try {
      const app = makeApp();
      const res = await app.request("/api/v1/onboard/status");
      const body = (await res.json()) as {
        items: Array<{ agent: string; detected: boolean }>;
      };
      expect(body.items.find((i) => i.agent === "claude-code")?.detected).toBe(true);
      expect(body.items.find((i) => i.agent === "codex")?.detected).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTMEMVIEW_HOME;
      } else {
        process.env.AGENTMEMVIEW_HOME = previous;
      }
    }
  });

  it("session diff buckets facts created in the session window", async () => {
    const app = makeApp();
    await app.request("/api/v1/dev/seed", { method: "POST" });
    const sessions = (await (await app.request("/api/v1/sessions")).json()) as {
      items: Array<{ id: string }>;
    };
    const sessionId = sessions.items[0]?.id ?? "";
    const diffRes = await app.request(`/api/v1/sessions/${sessionId}/diff`);
    expect(diffRes.status).toBe(200);
    const diff = (await diffRes.json()) as {
      added: unknown[];
      updated: unknown[];
      forgotten: unknown[];
    };
    expect(Array.isArray(diff.added)).toBe(true);
    expect(diff.added.length).toBeGreaterThan(0);
    const missing = await app.request("/api/v1/sessions/nope/diff");
    expect(missing.status).toBe(404);
  });

  it("injections SSE streams new records with ids", async () => {
    const app = makeApp();
    const streamRes = await app.request("/api/v1/injections/stream");
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    // record an injection; the same bus fans out to the open stream
    await app.request("/api/v1/injections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "s-1",
        turn: 1,
        blocks: [{ kind: "profile", tokens: 10, content: "x" }],
        tokens: { total: 10 },
        cachePrefixMd5: "abc",
      }),
    });
    const reader = streamRes.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) {
      return;
    }
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data:");
    expect(text).toContain("profile");
    await reader.cancel();
  });
});
