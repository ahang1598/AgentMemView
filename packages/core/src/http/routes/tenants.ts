import { Hono } from "hono";
import { z } from "zod";
import { TenantsDao } from "../../dao/tenants.js";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

const nameBody = z.object({ name: z.string().min(1).max(200) });
const serviceCreate = nameBody;
const servicePatch = nameBody.partial();

const spaceCreate = z.object({
  serviceId: z.string().min(1),
  name: z.string().min(1).max(200),
  metaJson: z.string().optional(),
});
const spacePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  metaJson: z.string().optional(),
});

const agentCreate = z.object({
  spaceId: z.string().min(1),
  kind: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
});
const agentPatch = z.object({
  kind: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(200).optional(),
});

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const forceQuerySchema = z.object({
  force: z.enum(["1", "true"]).optional(),
});

export const tenantsRoutes = new Hono<HttpEnv>()
  // ---- services ----
  .get("/services", validate("query", pageQuerySchema), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.listServices(c.req.valid("query")));
  })
  .post("/services", validate("json", serviceCreate), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.createService(c.req.valid("json")), 201);
  })
  .get("/services/:id", (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.getService(c.req.param("id")));
  })
  .patch("/services/:id", validate("json", servicePatch), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.patchService(c.req.param("id"), c.req.valid("json")));
  })
  .delete("/services/:id", (c) => {
    const dao = new TenantsDao(c.get("db"));
    dao.deleteService(c.req.param("id"));
    return c.body(null, 204);
  })
  // ---- spaces ----
  .get(
    "/spaces",
    validate("query", pageQuerySchema.extend({ serviceId: z.string().optional() })),
    (c) => {
      const dao = new TenantsDao(c.get("db"));
      return c.json(dao.listSpaces(c.req.valid("query")));
    },
  )
  .post("/spaces", validate("json", spaceCreate), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.createSpace(c.req.valid("json")), 201);
  })
  .get("/spaces/:id", (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.getSpace(c.req.param("id")));
  })
  .patch("/spaces/:id", validate("json", spacePatch), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.patchSpace(c.req.param("id"), c.req.valid("json")));
  })
  .delete("/spaces/:id", validate("query", forceQuerySchema), (c) => {
    const dao = new TenantsDao(c.get("db"));
    const force = c.req.valid("query").force !== undefined;
    dao.deleteSpace(c.req.param("id"), { force });
    return c.body(null, 204);
  })
  // ---- agents ----
  .get(
    "/agents",
    validate("query", pageQuerySchema.extend({ spaceId: z.string().optional() })),
    (c) => {
      const dao = new TenantsDao(c.get("db"));
      return c.json(dao.listAgents(c.req.valid("query")));
    },
  )
  .post("/agents", validate("json", agentCreate), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.createAgent(c.req.valid("json")), 201);
  })
  .get("/agents/:id", (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.getAgent(c.req.param("id")));
  })
  .patch("/agents/:id", validate("json", agentPatch), (c) => {
    const dao = new TenantsDao(c.get("db"));
    return c.json(dao.patchAgent(c.req.param("id"), c.req.valid("json")));
  })
  .delete("/agents/:id", (c) => {
    const dao = new TenantsDao(c.get("db"));
    dao.deleteAgent(c.req.param("id"));
    return c.body(null, 204);
  });
