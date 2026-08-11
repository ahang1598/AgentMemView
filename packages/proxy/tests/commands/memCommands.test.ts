import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMemCommand, parseMemCommand } from "../../src/commands/memCommands.js";

interface StubRequest {
  method: string;
  path: string;
  body: string;
}

async function startCoreStub(): Promise<{
  url: string;
  requests: StubRequest[];
  close: () => Promise<void>;
}> {
  const { createServer } = await import("node:http");
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      if ((req.url ?? "").includes("/memories/forget")) {
        res.end(JSON.stringify({ forgotten: 2 }));
      } else if ((req.url ?? "").includes("/injections")) {
        res.end(JSON.stringify({ items: [{ cachePrefixMd5: "abc", turn: 3 }] }));
      } else {
        res.end(JSON.stringify({ id: "fact-1", deduped: false }));
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub bind failed");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined ? reject(err) : resolve()));
      }),
  };
}

let stub: Awaited<ReturnType<typeof startCoreStub>>;
let upstreamCalls: number;

beforeEach(async () => {
  stub = await startCoreStub();
  upstreamCalls = 0;
});

afterEach(async () => {
  await stub.close();
});

function ctx() {
  return {
    coreBaseUrl: stub.url,
    spaceId: "space-1",
    protocol: "anthropic" as const,
    model: "claude-opus-4-7",
    // the proxy only calls handleMemCommand after local interception; the
    // upstream forwarder is never reached (asserted via upstreamCalls)
    touchUpstream: () => {
      upstreamCalls += 1;
    },
  };
}

describe("mem: commands (M2-07)", () => {
  it("parses command syntax", () => {
    expect(parseMemCommand("mem:remember 用户偏好 vim")).toEqual({
      command: "remember",
      arg: "用户偏好 vim",
    });
    expect(parseMemCommand("mem:status")).toEqual({ command: "status", arg: "" });
    expect(parseMemCommand("regular message")).toBeUndefined();
    expect(parseMemCommand("  mem:forget 密钥 ")).toEqual({ command: "forget", arg: "密钥" });
  });

  it("mem:remember writes l1 without upstream call", async () => {
    const result = await handleMemCommand(ctx(), "mem:remember 用户偏好 pnpm");
    expect(result.handled).toBe(true);
    expect(upstreamCalls).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.path).toBe("/api/v1/memories");
    const body = JSON.parse(stub.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body.content).toBe("用户偏好 pnpm");
    expect(body.spaceId).toBe("space-1");
    const text = result.text ?? "";
    expect(text).toContain("remembered");
  });

  it("mem:forget marks forgotten by query", async () => {
    const result = await handleMemCommand(ctx(), "mem:forget 密钥");
    expect(result.handled).toBe(true);
    expect(stub.requests[0]?.path).toBe("/api/v1/memories/forget");
    expect(result.text).toContain("2");
  });

  it("mem:status returns injection summary", async () => {
    const result = await handleMemCommand(ctx(), "mem:status");
    expect(result.handled).toBe(true);
    expect(stub.requests[0]?.path).toBe("/api/v1/injections");
    expect(result.text).toContain("abc");
  });

  it("mem:unknown → help text", async () => {
    const result = await handleMemCommand(ctx(), "mem:wat");
    expect(result.handled).toBe(true);
    expect(result.text).toContain("mem:remember");
    expect(stub.requests).toHaveLength(0);
  });

  it("synthesizes both protocol response shapes", async () => {
    const anthropic = await handleMemCommand(ctx(), "mem:status");
    expect(anthropic.response?.type).toBe("message");
    const openaiCtx = { ...ctx(), protocol: "openai" as const, model: "gpt-5" };
    const openai = await handleMemCommand(openaiCtx, "mem:status");
    expect(openai.response?.object).toBe("chat.completion");
  });
});
