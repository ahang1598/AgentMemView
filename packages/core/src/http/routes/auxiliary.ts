import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { FactsDao } from "../../dao/l1.js";
import type { HttpEnv } from "../app.js";
import { scopeForSpace } from "./memories.js";
import { validate } from "./validation.js";

/**
 * Auxiliary endpoints: forget-by-query (mem:forget command) and injection
 * records listing (Dashboard + mem:status).
 */

const forgetBody = z.object({
  spaceId: z.string().min(1),
  query: z.string().min(1).max(2000),
});

const injectionBody = z.object({
  sessionId: z.string().min(1),
  turn: z.number().int().min(0),
  blocks: z.array(z.unknown()),
  tokens: z.record(z.string(), z.number()),
  cachePrefixMd5: z.string().min(1),
});

export const auxRoutes = new Hono<HttpEnv>()
  .post("/memories/forget", validate("json", forgetBody), (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    const dao = new FactsDao(db, scopeForSpace(db, body.spaceId));
    const rows = db
      .prepare(`SELECT fact_id FROM l1_facts_fts WHERE content LIKE ? LIMIT 100`)
      .all(`%${body.query}%`) as Array<{ fact_id: string }>;
    let forgotten = 0;
    for (const row of rows) {
      const fact = dao.get(row.fact_id);
      if (fact !== undefined && fact.status === "active") {
        dao.forget(row.fact_id);
        forgotten += 1;
      }
    }
    return c.json({ forgotten });
  })
  .post("/injections", validate("json", injectionBody), (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    const id = randomUUID();
    db.prepare(
      `INSERT INTO injections (id, session_id, turn, blocks_json, token_json, cache_prefix_md5, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.sessionId,
      body.turn,
      JSON.stringify(body.blocks),
      JSON.stringify(body.tokens),
      body.cachePrefixMd5,
      new Date().toISOString(),
    );
    // real-time fan-out for the SSE stream (fail-open)
    try {
      c.get("bus").publish("injections.added", {
        id,
        sessionId: body.sessionId,
        turn: body.turn,
        blocks: body.blocks,
        tokens: body.tokens,
        cachePrefixMd5: body.cachePrefixMd5,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // observation must never break the write path
    }
    return c.json({ id }, 201);
  })
  .get("/injections/stream", (c) => {
    const bus = c.get("bus");
    const db = c.get("db");
    const sinceRaw = c.req.query("since");
    const since = sinceRaw !== undefined ? Number.parseInt(sinceRaw, 10) : 0;
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // replay missed events first (since = event bus id)
        const missed = bus.replay(Number.isNaN(since) ? 0 : since);
        for (const event of missed) {
          if (event.kind !== "injections.added") {
            continue;
          }
          controller.enqueue(
            encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event.payload)}\n\n`),
          );
        }
        unsubscribe = bus.subscribe((event) => {
          if (event.kind !== "injections.added") {
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event.payload)}\n\n`),
            );
          } catch {
            // client gone
          }
        });
        // heartbeat keeps intermediaries from closing idle streams
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15_000);
        void db; // db reserved for future scoped queries
        void heartbeat;
      },
      cancel() {
        unsubscribe?.();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  })
  .get("/injections", (c) => {
    const db = c.get("db");
    const rows = db
      .prepare(
        `SELECT id, session_id, turn, blocks_json, token_json, cache_prefix_md5, created_at
         FROM injections ORDER BY rowid DESC LIMIT 100`,
      )
      .all() as Array<{
      id: string;
      session_id: string | null;
      turn: number;
      blocks_json: string;
      token_json: string;
      cache_prefix_md5: string | null;
      created_at: string;
    }>;
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        turn: row.turn,
        blocks: JSON.parse(row.blocks_json),
        tokens: JSON.parse(row.token_json),
        cachePrefixMd5: row.cache_prefix_md5,
        createdAt: row.created_at,
      })),
    });
  });
