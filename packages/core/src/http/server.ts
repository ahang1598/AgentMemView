import { serve } from "@hono/node-server";
import type { AgentMemViewDatabase } from "../db/database.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import { createHttpApp } from "./app.js";

export interface ServerOptions {
  port: number;
  host: string;
  provider?: EmbeddingProvider;
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
  const server = serve({ fetch: app.fetch, port: options.port, hostname: options.host });
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
