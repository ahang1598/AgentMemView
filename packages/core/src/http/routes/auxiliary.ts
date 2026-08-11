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
    return c.json({ id }, 201);
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
