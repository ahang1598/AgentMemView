import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTurnMessages, isRoundFinalAssistant } from "../../src/writeback/extract.js";
import { L0Client } from "../../src/writeback/l0Client.js";

interface CoreStubRequest {
  path: string;
  body: string;
}

interface CoreStub {
  url: string;
  requests: CoreStubRequest[];
  setFailures: (n: number) => void;
  close: () => Promise<void>;
}

/** In-process stub of the core /api/v1/l0/messages endpoint. */
async function startCoreStub(): Promise<CoreStub> {
  const { createServer } = await import("node:http");
  const requests: CoreStubRequest[] = [];
  let failures = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
      if (failures > 0) {
        failures -= 1;
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "core down" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rows: 1 }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("core stub failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    setFailures: (n) => {
      failures = n;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined ? reject(err) : resolve()));
      }),
  };
}

let stub: CoreStub;

beforeEach(async () => {
  stub = await startCoreStub();
});

afterEach(async () => {
  await stub.close();
});

describe("L0 write-back client (M2-06, AC-04)", () => {
  it("stream completes → l0 appended", async () => {
    const client = new L0Client({ coreBaseUrl: stub.url, backoffMs: [1, 1, 1] });
    client.enqueue({
      sessionId: "sess-1",
      messages: [{ turn: 3, role: "user", content: "hello there" }],
    });
    await client.drain();
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.path).toBe("/api/v1/l0/messages");
    const body = JSON.parse(stub.requests[0]?.body ?? "{}") as {
      sessionId: string;
      messages: Array<{ content: string }>;
    };
    expect(body.sessionId).toBe("sess-1");
    expect(body.messages[0]?.content).toBe("hello there");
  });

  it("core down → 3 retries with backoff, caller unaffected", async () => {
    stub.setFailures(2); // fail twice, then succeed
    const client = new L0Client({ coreBaseUrl: stub.url, backoffMs: [1, 1, 1] });
    const enqueueResult = client.enqueue({
      sessionId: "sess-2",
      messages: [{ turn: 1, role: "user", content: "hi" }],
    });
    // enqueue returns immediately (fire-and-forget): response path unaffected
    expect(enqueueResult).toBeUndefined();
    await client.drain();
    // original attempt + 2 retries = 3 requests; succeeds on 3rd
    expect(stub.requests).toHaveLength(3);
  });

  it("gives up after max retries and dead-letters", async () => {
    stub.setFailures(99);
    const client = new L0Client({ coreBaseUrl: stub.url, backoffMs: [1, 1, 1] });
    client.enqueue({
      sessionId: "sess-3",
      messages: [{ turn: 1, role: "user", content: "lost" }],
    });
    await client.drain();
    // 1 original + 3 retries
    expect(stub.requests).toHaveLength(4);
    expect(client.deadLetters).toHaveLength(1);
  });

  it("redaction applied before persist", async () => {
    const client = new L0Client({ coreBaseUrl: stub.url, backoffMs: [1, 1, 1] });
    client.enqueue({
      sessionId: "sess-4",
      messages: [
        {
          turn: 1,
          role: "user",
          content: "key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcDEF",
        },
      ],
    });
    await client.drain();
    const body = JSON.parse(stub.requests[0]?.body ?? "{}") as {
      messages: Array<{ content: string; redacted?: number }>;
    };
    expect(body.messages[0]?.content).toContain("[REDACTED:anthropic-key]");
    expect(body.messages[0]?.content).not.toContain("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz");
  });
});

describe("turn extraction discipline", () => {
  it("round-level vs intra-round: only final tool-free assistant archives", () => {
    // intra-round assistant messages carrying tool_use must NOT archive
    expect(
      isRoundFinalAssistant({
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "shell", input: {} }],
      }),
    ).toBe(false);
    expect(
      isRoundFinalAssistant({ role: "assistant", content: [{ type: "text", text: "done" }] }),
    ).toBe(true);
    expect(isRoundFinalAssistant({ role: "user", content: "x" })).toBe(false);
  });

  it("extracts anthropic turn messages", () => {
    const body = {
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    };
    const turns = extractTurnMessages(body, 5);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn: 5, role: "user", content: "question" });
    expect(turns[1]?.content).toBe("answer");
  });
});
