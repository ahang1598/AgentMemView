import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "../../dao/errors.js";
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
  })
  .get("/sessions/:id/diff", (c) => {
    const db = c.get("db");
    const session = db
      .prepare("SELECT id, started_at, ended_at FROM sessions WHERE id = ?")
      .get(c.req.param("id")) as
      | { id: string; started_at: string; ended_at: string | null }
      | undefined;
    if (session === undefined) {
      throw new NotFoundError("session", c.req.param("id"));
    }
    const windowEnd = session.ended_at ?? new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT * FROM l1_facts
         WHERE (created_at BETWEEN ? AND ?)
            OR (updated_at BETWEEN ? AND ?)
         ORDER BY created_at ASC`,
      )
      .all(session.started_at, windowEnd, session.started_at, windowEnd) as Array<{
      id: string;
      space_id: string;
      content: string;
      status: string;
      pinned: number;
      confidence: number;
      half_life_days: number;
      access_count: number;
      last_accessed_at: string;
      source_message_id: string | null;
      superseded_by: string | null;
      created_at: string;
      updated_at: string;
    }>;
    const map = (row: (typeof rows)[number]) => ({
      id: row.id,
      spaceId: row.space_id,
      agentId: null,
      content: row.content,
      contentHash: "",
      status: row.status,
      pinned: row.pinned === 1,
      confidence: row.confidence,
      halfLifeDays: row.half_life_days,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      sourceMessageId: row.source_message_id,
      supersededBy: row.superseded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    const added = rows.filter((r) => r.created_at >= session.started_at && r.status === "active");
    const updated = rows.filter(
      (r) => r.created_at < session.started_at && r.updated_at >= session.started_at,
    );
    const forgotten = rows.filter((r) => r.status === "forgotten");
    return c.json({
      added: added.map(map),
      updated: updated.map(map),
      forgotten: forgotten.map(map),
    });
  });
