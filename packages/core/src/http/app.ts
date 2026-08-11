import { Hono } from "hono";
import type { AgentMemViewDatabase } from "../db/database.js";
import { MockEmbeddingProvider } from "../embedding/mock.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import { handleApiError } from "./errors.js";
import { assetsRoutes } from "./routes/assets.js";
import { auxRoutes } from "./routes/auxiliary.js";
import { l0Routes } from "./routes/l0.js";
import { memoriesRoutes } from "./routes/memories.js";
import { searchRoutes } from "./routes/search.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { tenantsRoutes } from "./routes/tenants.js";

export interface HttpEnv {
  Variables: {
    db: AgentMemViewDatabase;
    provider: EmbeddingProvider;
  };
}

export interface HttpAppOptions {
  /** Embedding provider for search/indexing; defaults to the deterministic
   * mock so the REST surface works fully offline (AC-02). The capability
   * center (M4) swaps in local/API/sidecar providers. */
  provider?: EmbeddingProvider;
}

/**
 * Assemble the core REST app (Spec section 11). Kept separate from server.ts
 * so tests can inject requests without binding a port.
 */
export function createHttpApp(
  db: AgentMemViewDatabase,
  options: HttpAppOptions = {},
): Hono<HttpEnv> {
  const provider = options.provider ?? new MockEmbeddingProvider();
  const app = new Hono<HttpEnv>();
  app.onError((err, c) => {
    const mapped = handleApiError(err, c);
    if (mapped !== undefined) {
      return mapped;
    }
    console.error(err);
    return c.json({ error: "internal", message: "internal server error" }, 500);
  });
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("provider", provider);
    await next();
  });
  app.get("/api/v1/health", (c) => c.json({ ok: true }));
  app.route("/api/v1", tenantsRoutes);
  app.route("/api/v1", memoriesRoutes);
  app.route("/api/v1", searchRoutes);
  app.route("/api/v1", l0Routes);
  app.route("/api/v1", auxRoutes);
  app.route("/api/v1", sessionsRoutes);
  app.route("/api/v1", assetsRoutes);
  return app;
}
