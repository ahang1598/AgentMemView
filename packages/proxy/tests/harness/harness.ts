import { createServer, type Server } from "node:http";

/**
 * Record/replay harness plumbing: serves a fetch-style app over real HTTP
 * (needed because the pipeline uses fetch against core/upstream).
 */

export interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

export interface ServedApp {
  url: string;
  close: () => Promise<void>;
}

export async function serveHono(app: FetchApp): Promise<ServedApp> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const host = req.headers.host ?? "127.0.0.1";
      const url = `http://${host}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            headers.append(key, item);
          }
        } else {
          headers.set(key, value);
        }
      }
      const method = req.method ?? "GET";
      const init: RequestInit =
        method === "GET" || method === "HEAD"
          ? { method, headers }
          : { method, headers, body: Buffer.concat(chunks) };
      void Promise.resolve(app.fetch(new Request(url, init)))
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        })
        .catch((err: Error) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("harness server failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined ? reject(err) : resolve()));
      }),
  };
}

/** Poll until predicate is true or timeout; returns final predicate value. */
export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) {
      return true;
    }
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
}
