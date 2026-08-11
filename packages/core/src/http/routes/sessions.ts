import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/** Sessions endpoints: lookup/ensure (proxy session mapping) + listing. */

const ensureBody = z.object({
  agentId: z.string().min(1),
  externalId: z.string().min(1),
});

export const sessionsRoutes = new Hono<HttpEnv>()
  .get("/sessions", (c) => {
    const db = c.get("db");
    const rows = db
      .prepare(
        `SELECT id, agent_id, external_id, started_at, ended_at, meta_json
         FROM sessions ORDER BY rowid DESC LIMIT 100`,
      )
      .all() as Array<{
      id: string;
      agent_id: string;
      external_id: string | null;
      started_at: string;
      ended_at: string | null;
      meta_json: string;
    }>;
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        externalId: row.external_id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      })),
    });
  })
  .post("/sessions/ensure", validate("json", ensureBody), (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    const existing = db
      .prepare("SELECT id FROM sessions WHERE agent_id = ? AND external_id = ?")
      .get(body.agentId, body.externalId) as { id: string } | undefined;
    if (existing !== undefined) {
      return c.json({ id: existing.id, created: false });
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO sessions (id, agent_id, external_id, started_at, meta_json) VALUES (?, ?, ?, ?, '{}')",
    ).run(id, body.agentId, body.externalId, new Date().toISOString());
    return c.json({ id, created: true }, 201);
  });
