import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { startHttpServer } from "../../src/http/server.js";

const tempDirs: string[] = [];
const tempServers: Array<{ close: () => Promise<void> }> = [];
const openDbs: AgentMemViewDatabase[] = [];

afterEach(async () => {
  for (const server of tempServers.splice(0)) {
    await server.close();
  }
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe("refine wiring (E2E regression)", () => {
  it("startHttpServer bootstraps default space and runs refine.l1 via worker", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-refine-"));
    tempDirs.push(dir);
    const db = openDatabase(path.join(dir, "agentmemview.db"));
    openDbs.push(db);
    migrate(db);

    const server = await startHttpServer(db, { port: 0, host: "127.0.0.1" });
    tempServers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    // bootstrap created the default space
    const spaces = (await (await fetch(`${base}/api/v1/spaces`)).json()) as {
      items: Array<{ id: string; name: string }>;
    };
    expect(spaces.items.map((s) => s.name)).toContain("default");
    const spaceId = spaces.items[0]?.id ?? "";

    // configure the LLM capability with a stubbed gateway is not possible via
    // config alone (fetch is global) — instead assert the HEURISTIC path:
    // write back a session with an explicit "记住：..." fact
    const agent = (await (
      await fetch(`${base}/api/v1/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, kind: "claude-code", name: "CC" }),
      })
    ).json()) as { id: string };
    const session = (await (
      await fetch(`${base}/api/v1/sessions/ensure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, externalId: "refine-e2e" }),
      })
    ).json()) as { id: string };

    const post = await fetch(`${base}/api/v1/l0/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        messages: [{ turn: 1, role: "user", content: "记住：我偏好 Rust 与 vim 键位" }],
      }),
    });
    expect(post.status).toBe(200);

    // refine.l1 job scheduled (5s debounce), worker executes heuristic strategy
    await sleep(7500);
    const facts = (await (await fetch(`${base}/api/v1/memories?spaceId=${spaceId}`)).json()) as {
      items: Array<{ content: string }>;
    };
    expect(facts.items.map((f) => f.content)).toContain("我偏好 Rust 与 vim 键位");
    const jobs = (await (await fetch(`${base}/api/v1/jobs`)).json()) as { deadLetters: number };
    expect(jobs.deadLetters).toBe(0);
  }, 20_000);
});
