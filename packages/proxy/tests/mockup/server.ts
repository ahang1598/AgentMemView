import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Mock upstream LLM server for record/replay tests (M2-10 infrastructure).
 * Scripted per test: captures received requests, returns queued responses
 * (JSON or SSE), can inject 429/500 or slow responses.
 */

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  /** Raw body; for SSE pass the full `event:/data:` text. */
  body: string;
  /** Delay in ms before responding (timeout tests). */
  delayMs?: number;
}

export interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface MockUpstream {
  url: string;
  captured: CapturedRequest[];
  enqueue: (res: MockResponse) => void;
  close: () => Promise<void>;
}

export async function startMockUpstream(): Promise<MockUpstream> {
  const queue: MockResponse[] = [];
  const captured: CapturedRequest[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      captured.push({
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const next = queue.shift();
      if (next === undefined) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock upstream queue empty" }));
        return;
      }
      const send = (): void => {
        const status = next.status ?? 200;
        const isSse = next.body.startsWith("event:") || next.body.startsWith("data:");
        const headers: Record<string, string> = {
          "content-type": isSse ? "text/event-stream" : "application/json",
          ...next.headers,
        };
        res.writeHead(status, headers);
        res.end(next.body);
      };
      if (next.delayMs !== undefined && next.delayMs > 0) {
        setTimeout(send, next.delayMs);
      } else {
        send();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock upstream failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    captured,
    enqueue: (res) => queue.push(res),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined ? reject(err) : resolve()));
      }),
  };
}
