import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentMemViewDatabase,
  createHttpApp,
  migrate,
  openDatabase,
} from "@agentmemview/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProxyApp } from "../../src/server.js";
import { type MockUpstream, startMockUpstream } from "../mockup/server.js";
import { type ServedApp, serveHono, waitFor } from "./harness.js";

/**
 * Record/replay golden cases (M2-10): request → proxy → mock upstream →
 * assert client output + core-side write-back. No real LLM involved.
 */

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

let coreDb: AgentMemViewDatabase;
let coreServer: ServedApp;
let upstream: MockUpstream;
let spaceId: string;
let proxy: ReturnType<typeof createProxyApp>;
const tempDirs: string[] = [];

async function seedTenants(coreUrl: string): Promise<string> {
  const svc = (await (
    await fetch(`${coreUrl}/api/v1/services`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "golden" }),
    })
  ).json()) as { id: string };
  const space = (await (
    await fetch(`${coreUrl}/api/v1/spaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: svc.id, name: "default" }),
    })
  ).json()) as { id: string };
  await fetch(`${coreUrl}/api/v1/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spaceId: space.id, kind: "claude-code", name: "CC" }),
  });
  return space.id;
}

async function l0Items(coreUrl: string): Promise<Array<{ role: string; content: string }>> {
  const body = (await (await fetch(`${coreUrl}/api/v1/l0/messages`)).json()) as {
    items: Array<{ role: string; content: string }>;
  };
  return body.items;
}

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-harness-"));
  tempDirs.push(dir);
  coreDb = openDatabase(path.join(dir, "agentmemview.db"));
  migrate(coreDb);
  coreServer = await serveHono(createHttpApp(coreDb));
  upstream = await startMockUpstream();
  spaceId = await seedTenants(coreServer.url);
  proxy = createProxyApp({
    coreBaseUrl: coreServer.url,
    upstreamBase: upstream.url,
  });
});

afterEach(async () => {
  await coreServer.close();
  await upstream.close();
  coreDb.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("golden case replay (M2-10)", () => {
  it("case 1: simple Q&A (non-stream) round trip + write-back", async () => {
    const upstreamBody = {
      id: "msg_golden1",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [{ type: "text", text: "The answer is 42." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    upstream.enqueue({ body: JSON.stringify(upstreamBody) });

    const res = await proxy.request(`/claude-code/${spaceId}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 100,
        metadata: { session_id: "golden-1" },
        messages: [{ role: "user", content: "What is the answer?" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstreamBody);
    expect(upstream.captured).toHaveLength(1);

    // write-back lands in core L0 (fire-and-forget; poll)
    const landed = await waitFor(async () => (await l0Items(coreServer.url)).length >= 2);
    expect(landed).toBe(true);
    const items = await l0Items(coreServer.url);
    expect(items.some((i) => i.role === "user" && i.content.includes("What is the answer?"))).toBe(
      true,
    );
    expect(items.some((i) => i.role === "assistant" && i.content.includes("42"))).toBe(true);
  });

  it("case 2: SSE tool-call stream stays byte-identical + captured", async () => {
    const sse = readFileSync(path.join(fixtureDir, "anthropic-sse.txt"), "utf8");
    upstream.enqueue({ body: sse });

    const res = await proxy.request(`/claude-code/${spaceId}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 100,
        stream: true,
        metadata: { session_id: "golden-2" },
        messages: [{ role: "user", content: "say hello" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe(sse);

    const landed = await waitFor(async () =>
      (await l0Items(coreServer.url)).some(
        (i) => i.role === "assistant" && i.content.includes("Hello world"),
      ),
    );
    expect(landed).toBe(true);
  });

  it("case 3: 429 then success retries once transparently", async () => {
    upstream.enqueue({ status: 429, body: JSON.stringify({ error: { message: "slow down" } }) });
    const recovered = {
      id: "msg_golden3",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "recovered" }],
    };
    upstream.enqueue({ body: JSON.stringify(recovered) });

    const res = await proxy.request(`/claude-code/${spaceId}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 100,
        metadata: { session_id: "golden-3" },
        messages: [{ role: "user", content: "retry me" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(recovered);
    expect(upstream.captured).toHaveLength(2);
  });

  it("mem:status is answered locally with zero upstream calls", async () => {
    const res = await proxy.request(`/claude-code/${spaceId}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 100,
        metadata: { session_id: "golden-4" },
        messages: [{ role: "user", content: "mem:status" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe("message");
    expect(upstream.captured).toHaveLength(0);
  });
});
