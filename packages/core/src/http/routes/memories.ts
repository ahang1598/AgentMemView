import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "../../dao/errors.js";
import { FactsDao } from "../../dao/l1.js";
import { TenantsDao } from "../../dao/tenants.js";
import { ensureEngineVecTable } from "../../retrieval/engine.js";
import type { Scope } from "../../scope/context.js";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/** Resolve a space-scoped DAO context; throws NotFoundError for bad spaces. */
export function scopeForSpace(db: HttpEnv["Variables"]["db"], spaceId: string): Scope {
  const tenants = new TenantsDao(db);
  const space = tenants.getSpace(spaceId);
  return { serviceId: space.serviceId, spaceId: space.id };
}

const memoryCreate = z.object({
  spaceId: z.string().min(1),
  content: z.string().min(1).max(20_000),
  agentId: z.string().optional(),
  pinned: z.boolean().optional(),
});

const memoryPatch = z.object({
  content: z.string().min(1).max(20_000),
});

const pinBody = z.object({
  pinned: z.boolean().optional(),
});

const memoryListQuery = z.object({
  spaceId: z.string().min(1),
  includeAllStatuses: z.enum(["1", "true"]).optional(),
});

export const memoriesRoutes = new Hono<HttpEnv>()
  .post("/memories", validate("json", memoryCreate), async (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    const scope = scopeForSpace(db, body.spaceId);
    const dao = new FactsDao(db, scope);
    const created = dao.create({
      content: body.content,
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    });
    // best-effort vector index (search vec channel); never block the write
    try {
      const provider = c.get("provider");
      const table = ensureEngineVecTable(db, provider);
      const [vector] = await provider.embed([body.content]);
      if (vector !== undefined) {
        db.prepare(`INSERT INTO "${table}" (fact_id, embedding) VALUES (?, ?)`).run(
          created.id,
          Buffer.from(new Float32Array(vector).buffer),
        );
      }
    } catch {
      // fail-open: FTS channel still serves retrieval (AC-02 offline)
    }
    return c.json(created, 201);
  })
  .get("/memories", validate("query", memoryListQuery), (c) => {
    const query = c.req.valid("query");
    const db = c.get("db");
    const dao = new FactsDao(db, scopeForSpace(db, query.spaceId));
    const facts = dao.list({ includeAllStatuses: query.includeAllStatuses !== undefined });
    return c.json({ items: facts, nextCursor: null });
  })
  .patch("/memories/:id", validate("json", memoryPatch), (c) => {
    const db = c.get("db");
    const { id } = c.req.param();
    const located = locateFact(db, id);
    const dao = new FactsDao(db, scopeForSpace(db, located.spaceId));
    const updated = dao.update(id, c.req.valid("json"));
    return c.json(updated);
  })
  .get("/memories/:id/lineage", (c) => {
    const db = c.get("db");
    const { id } = c.req.param();
    const located = locateFact(db, id);
    const dao = new FactsDao(db, scopeForSpace(db, located.spaceId));
    return c.json({ chain: dao.lineage(id) });
  })
  .get("/memories/:id", (c) => {
    const db = c.get("db");
    const { id } = c.req.param();
    const located = locateFact(db, id);
    const dao = new FactsDao(db, scopeForSpace(db, located.spaceId));
    return c.json(dao.get(id));
  })
  .post("/memories/:id/pin", validate("json", pinBody), (c) => {
    const db = c.get("db");
    const { id } = c.req.param();
    const located = locateFact(db, id);
    const dao = new FactsDao(db, scopeForSpace(db, located.spaceId));
    const pinned = c.req.valid("json").pinned ?? true;
    return c.json(dao.pin(id, pinned));
  })
  .post("/memories/:id/recover", (c) => {
    const db = c.get("db");
    const { id } = c.req.param();
    const located = locateFact(db, id);
    const dao = new FactsDao(db, scopeForSpace(db, located.spaceId));
    return c.json(dao.recover(id));
  });

/** Minimal cross-space id lookup used only to route into the right scope. */
function locateFact(db: HttpEnv["Variables"]["db"], id: string): { spaceId: string } {
  const row = db.prepare("SELECT space_id FROM l1_facts WHERE id = ?").get(id) as
    | { space_id: string }
    | undefined;
  if (row === undefined) {
    throw new NotFoundError("memory", id);
  }
  return { spaceId: row.space_id };
}
