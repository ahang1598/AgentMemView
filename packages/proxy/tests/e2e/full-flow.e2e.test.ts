import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentMemViewDatabase,
  createHttpApp,
  migrate,
  openDatabase,
} from "@agentmemview/core";
import { afterEach, describe, expect, it } from "vitest";
import { createProxyApp } from "../../src/server.js";
import { type ServedApp, serveHono, waitFor } from "../harness/harness.js";
import { type MockUpstream, startMockUpstream } from "../mockup/server.js";

/**
 * E2E full flow (M2-12): core + proxy + mock upstream. Simulates an
 * Anthropic two-round conversation with a tool call; asserts client
 * responses plus injections / l0 / traces rows in core.
 */

let coreDb: AgentMemViewDatabase;
let coreServer: ServedApp;
let proxyServer: ServedApp;
let upstream: MockUpstream;
let spaceId: string;
const tempDirs: string[] = [];

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

afterEach(async () => {
  await proxyServer.close();
  await coreServer.close();
  await upstream.close();
  coreDb.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("E2E full flow (M2-12)", () => {
  it("two-round conversation with tool call leaves full observability trail", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-e2e-"));
    tempDirs.push(dir);
    coreDb = openDatabase(path.join(dir, "agentmemview.db"));
    migrate(coreDb);
    coreServer = await serveHono(createHttpApp(coreDb));
    upstream = await startMockUpstream();

    const svc = (await postJson(`${coreServer.url}/api/v1/services`, { name: "e2e" })) as {
      id: string;
    };
    const space = (await postJson(`${coreServer.url}/api/v1/spaces`, {
      serviceId: svc.id,
      name: "default",
    })) as { id: string };
    spaceId = space.id;
    await postJson(`${coreServer.url}/api/v1/agents`, {
      spaceId,
      kind: "claude-code",
      name: "CC",
    });

    const proxyApp = createProxyApp({
      coreBaseUrl: coreServer.url,
      upstreamBase: upstream.url,
    });
    proxyServer = await serveHono(proxyApp);

    // round 1: assistant asks for a tool (stream with tool_use delta text)
    upstream.enqueue({
      body: JSON.stringify({
        id: "msg_r1",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the file." },
          { type: "tool_use", id: "toolu_e2e", name: "read_file", input: { path: "a.ts" } },
        ],
        stop_reason: "tool_use",
      }),
    });
    const r1 = await fetch(`${proxyServer.url}/claude-code/${spaceId}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 1000,
        metadata: { session_id: "e2e-session" },
        messages: [{ role: "user", content: "read a.ts please" }],
      }),
    });
    expect(r1.status).toBe(200);
    const r1Body = (await r1.json()) as { stop_reason: string };
    expect(r1Body.stop_reason).toBe("tool_use");

    // round 2: final answer (no tool_use) — round-level archive trigger
    upstream.enqueue({
      body: JSON.stringify({
        id: "msg_r2",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "The file exports add()." }],
        stop_reason: "end_turn",
      }),
    });
    const r2 = await fetch(`${proxyServer.url}/claude-code/${spaceId}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 1000,
        metadata: { session_id: "e2e-session" },
        messages: [
          { role: "user", content: "read a.ts please" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Let me check the file." },
              { type: "tool_use", id: "toolu_e2e", name: "read_file", input: { path: "a.ts" } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_e2e", content: "export add()" }],
          },
        ],
      }),
    });
    expect(r2.status).toBe(200);
    expect(upstream.captured).toHaveLength(2);

    // observability trail: injections rows exist (main classification)
    const injected = await waitFor(async () => {
      const body = (await (await fetch(`${coreServer.url}/api/v1/injections`)).json()) as {
        items: unknown[];
      };
      return body.items.length >= 2;
    });
    expect(injected).toBe(true);

    // l0 rows contain both user turns and assistant answers
    const l0Landed = await waitFor(async () => {
      const body = (await (await fetch(`${coreServer.url}/api/v1/l0/messages`)).json()) as {
        items: Array<{ role: string; content: string }>;
      };
      return (
        body.items.some((i) => i.content.includes("read a.ts please")) &&
        body.items.some((i) => i.content.includes("The file exports add()."))
      );
    });
    expect(l0Landed).toBe(true);

    // search leaves a trace row
    const search = (await postJson(`${coreServer.url}/api/v1/search`, {
      query: "file exports",
      spaceId,
    })) as { traceId: string };
    const trace = (await (
      await fetch(`${coreServer.url}/api/v1/traces/${search.traceId}`)
    ).json()) as {
      stages: Array<{ stage: string }>;
    };
    expect(trace.stages.map((s) => s.stage)).toEqual([
      "prefilter",
      "fts",
      "vec",
      "rrf",
      "decay",
      "final",
    ]);
  }, 20_000);
});
