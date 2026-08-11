import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "../../dao/errors.js";
import { EventBus } from "../../events/bus.js";
import { RetrievalEngine } from "../../retrieval/engine.js";
import type { HttpEnv } from "../app.js";
import { scopeForSpace } from "./memories.js";
import { validate } from "./validation.js";

const searchBody = z.object({
  query: z.string().min(1).max(2000),
  spaceId: z.string().min(1),
  agentId: z.string().optional(),
  topK: z.number().int().min(1).max(50).optional(),
  sessionId: z.string().optional(),
});

export const searchRoutes = new Hono<HttpEnv>()
  .post("/search", validate("json", searchBody), async (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    const scope = scopeForSpace(db, body.spaceId);
    if (body.agentId !== undefined) {
      scope.agentId = body.agentId;
    }
    const engine = new RetrievalEngine({
      db,
      scope,
      provider: c.get("provider"),
      bus: new EventBus(db),
      ...(body.topK !== undefined ? { topK: body.topK } : {}),
    });
    const { results, traceId } = await engine.search(
      body.query,
      body.sessionId !== undefined ? { sessionId: body.sessionId } : {},
    );
    return c.json({ results, traceId });
  })
  .get("/traces", (c) => {
    const db = c.get("db");
    const rows = db
      .prepare(
        `SELECT id, query, latency_ms, created_at FROM retrieval_traces
         ORDER BY created_at DESC, rowid DESC LIMIT 50`,
      )
      .all() as Array<{ id: string; query: string; latency_ms: number; created_at: string }>;
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        query: row.query,
        latencyMs: row.latency_ms,
        createdAt: row.created_at,
      })),
    });
  })
  .get("/traces/:id", (c) => {
    const db = c.get("db");
    const row = db.prepare("SELECT * FROM retrieval_traces WHERE id = ?").get(c.req.param("id")) as
      | {
          id: string;
          session_id: string | null;
          query: string;
          scope_json: string;
          stages_json: string;
          results_json: string;
          latency_ms: number;
          created_at: string;
        }
      | undefined;
    if (row === undefined) {
      throw new NotFoundError("trace", c.req.param("id"));
    }
    return c.json({
      id: row.id,
      sessionId: row.session_id,
      query: row.query,
      scope: JSON.parse(row.scope_json),
      stages: JSON.parse(row.stages_json),
      results: JSON.parse(row.results_json),
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
    });
  });
