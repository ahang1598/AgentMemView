import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentMemViewDatabase,
  createHttpApp,
  migrate,
  openDatabase,
} from "@agentmemview/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentMemViewMcp, type McpServer } from "../src/index.js";

/** MCP tools tests drive handlers directly against a real core server. */

interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

let coreDb: AgentMemViewDatabase;
let coreServer: Server;
let coreUrl: string;
let mcp: McpServer;
let spaceA: string;
const tempDirs: string[] = [];

async function serveHono(app: FetchApp): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
      const method = req.method ?? "GET";
      const init: RequestInit =
        method === "GET" || method === "HEAD"
          ? { method, headers: req.headers as Record<string, string> }
          : { method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) };
      void Promise.resolve(app.fetch(new Request(url, init)))
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("core server failed to bind");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function callJson(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await mcp.callTool(name, args);
  expect(result.isError).toBe(false);
  return JSON.parse(result.content[0]?.text ?? "null");
}

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-mcp-"));
  tempDirs.push(dir);
  coreDb = openDatabase(path.join(dir, "agentmemview.db"));
  migrate(coreDb);
  const served = await serveHono(createHttpApp(coreDb));
  coreServer = served.server;
  coreUrl = served.url;
  const svc = (await postJson(`${coreUrl}/api/v1/services`, { name: "mcp" })) as { id: string };
  spaceA = (
    (await postJson(`${coreUrl}/api/v1/spaces`, {
      serviceId: svc.id,
      name: "alpha",
    })) as { id: string }
  ).id;
  await postJson(`${coreUrl}/api/v1/spaces`, {
    serviceId: svc.id,
    name: "beta",
  });
  mcp = createAgentMemViewMcp({ coreBaseUrl: coreUrl, defaultSpace: "alpha" });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    coreServer.close(() => resolve());
  });
  coreDb.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("MCP server (M2-11)", () => {
  it("lists exactly the locked 8 tools", async () => {
    const response = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response).toBeDefined();
    const result = response?.result as { tools: Array<{ name: string }> } | undefined;
    const tools = result?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "memory_forget",
        "memory_pin",
        "memory_read",
        "memory_search",
        "memory_traces",
        "memory_write",
        "profile_read",
        "skills_list",
      ].sort(),
    );
  });

  it("initialize handshake returns server info", async () => {
    const response = await mcp.handle({ jsonrpc: "2.0", id: 2, method: "initialize" });
    const result = response?.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe("agentmemview-mcp");
  });

  it("memory_write respects scope; memory_search returns trace_id", async () => {
    const written = (await callJson("memory_write", {
      content: "MCP 写入的作用域事实",
      space: "alpha",
    })) as { id: string };
    expect(typeof written.id).toBe("string");

    const searchA = (await callJson("memory_search", {
      query: "作用域事实",
      space: "alpha",
    })) as { results: unknown[]; traceId: string };
    expect(searchA.results.length).toBeGreaterThanOrEqual(1);
    expect(typeof searchA.traceId).toBe("string");

    // foreign scope sees nothing (AC-11 via MCP)
    const searchB = (await callJson("memory_search", {
      query: "作用域事实",
      space: "beta",
    })) as { results: unknown[] };
    expect(searchB.results).toEqual([]);
  });

  it("memory_read/pin/forget/trace flows", async () => {
    const written = (await callJson("memory_write", { content: "生命周期测试事实内容" })) as {
      id: string;
    };
    const read = (await callJson("memory_read", { id: written.id })) as {
      fact: { pinned: boolean };
      lineage: { chain: unknown[] };
    };
    expect(read.fact.pinned).toBe(false);
    expect(read.lineage.chain.length).toBeGreaterThanOrEqual(1);

    const pinned = (await callJson("memory_pin", { id: written.id })) as { pinned: boolean };
    expect(pinned.pinned).toBe(true);

    await callJson("memory_search", { query: "生命周期测试" });
    const traces = (await callJson("memory_traces", {})) as { items: unknown[] };
    expect(traces.items.length).toBeGreaterThanOrEqual(1);

    const forgotten = (await callJson("memory_forget", { query: "生命周期测试事实" })) as {
      forgotten: number;
    };
    expect(forgotten.forgotten).toBeGreaterThanOrEqual(1);
  });

  it("profile_read and skills_list respond with schema shape", async () => {
    const profile = (await callJson("profile_read", { scope: `space:${spaceA}` })) as {
      contentMd: unknown;
    };
    expect(profile.contentMd).toBeNull();
    const skills = (await callJson("skills_list", { space: "alpha" })) as { items: unknown[] };
    expect(skills.items).toEqual([]);
  });

  it("unknown tool reports error result", async () => {
    const result = await mcp.callTool("memory_explode", {});
    expect(result.isError).toBe(true);
  });
});
