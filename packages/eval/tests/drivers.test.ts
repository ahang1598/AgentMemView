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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvalCoreClient } from "../src/drivers/coreClient.js";

interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

let db: AgentMemViewDatabase;
let server: Server;
let baseUrl: string;
let tempDir: string;

async function serveHono(app: FetchApp): Promise<{ server: Server; url: string }> {
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
      const method = req.method ?? "GET";
      const init: RequestInit =
        method === "GET" || method === "HEAD"
          ? { method, headers: req.headers as Record<string, string> }
          : {
              method,
              headers: req.headers as Record<string, string>,
              body: Buffer.concat(chunks),
            };
      void Promise.resolve(app.fetch(new Request(url, init)))
        .then(async (response: Response) => {
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
    srv.listen(0, "127.0.0.1", resolve);
  });
  const address = srv.address();
  if (address === null || typeof address === "string") {
    throw new Error("eval core server failed to bind");
  }
  return { server: srv, url: `http://127.0.0.1:${address.port}` };
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "agentmemview-evaldrv-"));
  db = openDatabase(path.join(tempDir, "agentmemview.db"));
  migrate(db);
  const served = await serveHono(createHttpApp(db));
  server = served.server;
  baseUrl = served.url;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("eval drivers (M5-02)", () => {
  it("ingest writes facts to isolated eval space", async () => {
    const client = new EvalCoreClient({ baseUrl });
    const { spaceId } = await client.ensureEvalSpace("synthetic", "run-1");
    const ids = await client.ingestFacts(spaceId, [
      "评测事实一：包管理器偏好 pnpm",
      "评测事实二：部署在本地",
    ]);
    expect(ids).toHaveLength(2);
    // isolated tenancy: service=eval, space=synthetic-run-1
    const spaces = (await (await fetch(`${baseUrl}/api/v1/spaces`)).json()) as {
      items: Array<{ id: string; name: string; serviceId: string }>;
    };
    const evalSpace = spaces.items.find((s) => s.id === spaceId);
    expect(evalSpace?.name).toBe("synthetic-run-1");
    const services = (await (await fetch(`${baseUrl}/api/v1/services`)).json()) as {
      items: Array<{ id: string; name: string }>;
    };
    const evalService = services.items.find((s) => s.id === evalSpace?.serviceId);
    expect(evalService?.name).toBe("eval");
  });

  it("retrieve returns ranked fact ids per question with trace ids", async () => {
    const client = new EvalCoreClient({ baseUrl });
    const { spaceId } = await client.ensureEvalSpace("synthetic", "run-1");
    const result = await client.retrieve(spaceId, "包管理器偏好");
    expect(result.factIds.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.traceId).toBe("string");
    const trace = await (await fetch(`${baseUrl}/api/v1/traces/${result.traceId}`)).json();
    expect((trace as { stages: unknown[] }).stages).toHaveLength(6);
  });
});
