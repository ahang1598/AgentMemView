import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { bootstrapDefaultTenants } from "../dao/tenants.js";
import type { AgentMemViewDatabase } from "../db/database.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import { JobQueue } from "../jobs/queue.js";
import { JobWorker } from "../jobs/worker.js";
import { OpenAICompatLLMProvider, validateLLMConfig } from "../providers/llm/openai-compat.js";
import {
  HeuristicStrategy,
  LlmStrategy,
  type RefineStrategy,
  runL1Extract,
} from "../refine/l1Extract.js";
import type { Scope } from "../scope/context.js";
import { createHttpApp } from "./app.js";
import { staticFileResponse } from "./static.js";

export interface ServerOptions {
  port: number;
  host: string;
  provider?: EmbeddingProvider | undefined;
  /** UI build dir; defaults to packages/ui/dist when present. */
  staticDir?: string | undefined;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/** Bind the core REST app to a port (used by `agentmemview start`). */
export async function startHttpServer(
  db: AgentMemViewDatabase,
  options: ServerOptions,
): Promise<RunningServer> {
  // first-run bootstrap: a fresh DB gets a default service + space so the
  // proxy pipeline (space resolution, sessions, write-back) works out of box
  bootstrapDefaultTenants(db);
  // background worker: runs the L1 refinement jobs enqueued by L0 write-back.
  // Strategy is re-read from hot config on every run (capability center).
  const queue = new JobQueue(db);
  const worker = new JobWorker(db, queue);
  worker.register("refine.l1", async (payload) => {
    const sessionId = String(payload.sessionId ?? "");
    const spaceId = String(payload.spaceId ?? "");
    if (sessionId === "" || spaceId === "") {
      return;
    }
    const space = db.prepare("SELECT service_id FROM spaces WHERE id = ?").get(spaceId) as
      | { service_id: string }
      | undefined;
    if (space === undefined) {
      return;
    }
    const scope: Scope = { serviceId: space.service_id, spaceId };
    let strategy: RefineStrategy = new HeuristicStrategy();
    const configRow = db
      .prepare("SELECT value_json FROM config WHERE key = 'capability.llm-gateway'")
      .get() as { value_json: string } | undefined;
    if (configRow !== undefined) {
      try {
        const config = JSON.parse(configRow.value_json) as Record<string, unknown>;
        if (validateLLMConfig(config).length === 0) {
          strategy = new LlmStrategy(new OpenAICompatLLMProvider(config as never));
        }
      } catch {
        // malformed config: degrade to heuristic
      }
    }
    await runL1Extract({ db, scope, sessionId, strategy });
  });
  worker.start();
  const app = createHttpApp(
    db,
    options.provider !== undefined ? { provider: options.provider } : {},
  );
  const defaultStaticDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../ui/dist",
  );
  const staticDir =
    options.staticDir ?? (existsSync(defaultStaticDir) ? defaultStaticDir : undefined);
  const fetchHandler = async (req: Request): Promise<Response> => {
    const res = await app.fetch(req);
    if (res.status !== 404 || staticDir === undefined) {
      return res;
    }
    const fallback = staticFileResponse(staticDir, new URL(req.url).pathname);
    return fallback ?? res;
  };
  const server = serve({ fetch: fetchHandler, port: options.port, hostname: options.host });
  // port 0 picks an ephemeral port; report the actually bound one
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;
  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        worker.stop();
        server.close((err) => {
          if (err !== undefined) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}
