import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { AgentMemViewDatabase } from "../db/database.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
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
  return {
    port: options.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
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
