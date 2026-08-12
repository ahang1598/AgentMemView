import { Hono } from "hono";
import { z } from "zod";
import { L0Dao } from "../../dao/l0.js";
import { EventBus } from "../../events/bus.js";
import { JobQueue } from "../../jobs/queue.js";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/**
 * L0 write-back endpoint used by the transparent proxy (fire-and-forget
 * client with retries). Kept minimal: session id + turn messages.
 */

const l0Body = z.object({
  sessionId: z.string().min(1),
  messages: z
    .array(
      z.object({
        turn: z.number().int().min(0),
        role: z.string().min(1).max(40),
        content: z.string().max(100_000),
      }),
    )
    .min(1)
    .max(500),
});

const l0Query = z.object({
  sessionId: z.string().optional(),
});

export const l0Routes = new Hono<HttpEnv>()
  .get("/l0/messages", validate("query", l0Query), (c) => {
    const db = c.get("db");
    const sessionId = c.req.valid("query").sessionId;
    const rows =
      sessionId !== undefined
        ? (db
            .prepare(
              `SELECT id, session_id, turn, seq, role, content, redacted FROM l0_messages
               WHERE session_id = ? ORDER BY turn, seq LIMIT 500`,
            )
            .all(sessionId) as Array<Record<string, unknown>>)
        : (db
            .prepare(
              `SELECT id, session_id, turn, seq, role, content, redacted FROM l0_messages
               ORDER BY rowid DESC LIMIT 500`,
            )
            .all() as Array<Record<string, unknown>>);
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        turn: row.turn,
        seq: row.seq,
        role: row.role,
        content: row.content,
        redacted: row.redacted,
      })),
    });
  })
  .post("/l0/messages", validate("json", l0Body), (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    // FK guard: a bare/unknown session id would throw SQLITE_CONSTRAINT and
    // spam the log; surface a clear 400 so callers (proxy) can fix it.
    const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(body.sessionId) as
      | { id: string }
      | undefined;
    if (session === undefined) {
      return c.json(
        {
          error: "validation",
          message: `session ${body.sessionId} not found; create it via POST /api/v1/sessions/ensure first`,
        },
        400,
      );
    }
    const dao = new L0Dao(db, new EventBus(db));
    const rows = dao.appendMessages(body.sessionId, body.messages);
    // refinement trigger: schedule L1 extraction for this session (debounced
    // by dedupe; the worker picks the strategy from hot config). Fail-open.
    try {
      const space = db
        .prepare(
          `SELECT sp.id AS space_id FROM sessions s
           JOIN agents a ON a.id = s.agent_id
           JOIN spaces sp ON sp.id = a.space_id
           WHERE s.id = ?`,
        )
        .get(body.sessionId) as { space_id: string } | undefined;
      if (space !== undefined) {
        const queue = new JobQueue(db);
        const dup = db
          .prepare(
            `SELECT id FROM jobs WHERE type = 'refine.l1'
             AND status IN ('pending', 'running') AND payload_json LIKE ?`,
          )
          .get(`%"sessionId":"${body.sessionId}"%`) as { id: string } | undefined;
        if (dup === undefined) {
          queue.enqueue(
            "refine.l1",
            { sessionId: body.sessionId, spaceId: space.space_id, strategy: "llm" },
            { runAfterMs: 5000 },
          );
        }
      }
    } catch {
      // refinement is an enhancement; write-back must never fail because of it
    }
    return c.json({ rows });
  });
