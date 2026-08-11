import { Hono } from "hono";
import { z } from "zod";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/** Read-only asset endpoints consumed by the proxy injection sources. */

const spaceQuery = z.object({ spaceId: z.string().min(1) });

export const assetsRoutes = new Hono<HttpEnv>()
  .get("/profiles/:scope", (c) => {
    const db = c.get("db");
    const row = db
      .prepare(
        `SELECT content_md, version, updated_at FROM l3_profiles
         WHERE scope_key = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(c.req.param("scope")) as
      | { content_md: string; version: number; updated_at: string }
      | undefined;
    if (row === undefined) {
      return c.json({ contentMd: null });
    }
    return c.json({ contentMd: row.content_md, version: row.version, updatedAt: row.updated_at });
  })
  .get("/scenarios", validate("query", spaceQuery), (c) => {
    const db = c.get("db");
    const rows = db
      .prepare(
        `SELECT id, title, summary, token_estimate, updated_at FROM l2_scenarios
         WHERE space_id = ? ORDER BY updated_at DESC LIMIT 100`,
      )
      .all(c.req.valid("query").spaceId) as Array<{
      id: string;
      title: string;
      summary: string;
      token_estimate: number;
      updated_at: string;
    }>;
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        tokenEstimate: row.token_estimate,
        updatedAt: row.updated_at,
      })),
    });
  })
  .get("/skills", validate("query", spaceQuery), (c) => {
    const db = c.get("db");
    const rows = db
      .prepare(
        `SELECT id, name, version, content, status FROM skills
         WHERE space_id = ? AND status = 'active' ORDER BY rowid DESC LIMIT 100`,
      )
      .all(c.req.valid("query").spaceId) as Array<{
      id: string;
      name: string;
      version: number;
      content: string;
      status: string;
    }>;
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        content: row.content,
      })),
    });
  });
