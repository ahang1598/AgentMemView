import { randomUUID } from "node:crypto";
import type { AgentMemViewDatabase } from "../db/database.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { type Page, type PageOptions, pageQuery } from "./page.js";

/**
 * Tenancy management-plane DAO (services/spaces/agents). These are admin
 * operations above the space scope; all memory-data access still goes through
 * ScopedDao subclasses with mandatory scope filtering.
 */

export type { Page, PageOptions };

export interface ServiceRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface SpaceRow {
  id: string;
  serviceId: string;
  name: string;
  metaJson: string;
  createdAt: string;
}

export interface AgentRow {
  id: string;
  spaceId: string;
  kind: string;
  name: string;
}

function now(): string {
  return new Date().toISOString();
}

export class TenantsDao {
  constructor(private readonly db: AgentMemViewDatabase) {}

  // ---- services ----

  createService(input: { name: string }): ServiceRow {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO services (id, name, created_at) VALUES (?, ?, ?)")
      .run(id, input.name, now());
    return this.getService(id);
  }

  getService(id: string): ServiceRow {
    const row = this.db.prepare("SELECT * FROM services WHERE id = ?").get(id) as
      | { id: string; name: string; created_at: string }
      | undefined;
    if (row === undefined) {
      throw new NotFoundError("service", id);
    }
    return { id: row.id, name: row.name, createdAt: row.created_at };
  }

  listServices(options: PageOptions = {}): Page<ServiceRow> {
    const { rows, nextCursor } = pageQuery(this.db, "services", options);
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        createdAt: String(r.created_at),
      })),
      nextCursor,
    };
  }

  patchService(id: string, patch: { name?: string | undefined }): ServiceRow {
    this.getService(id);
    if (patch.name !== undefined) {
      this.db.prepare("UPDATE services SET name = ? WHERE id = ?").run(patch.name, id);
    }
    return this.getService(id);
  }

  deleteService(id: string): void {
    this.getService(id);
    const spaces = this.db.prepare("SELECT id FROM spaces WHERE service_id = ?").all(id) as Array<{
      id: string;
    }>;
    if (spaces.length > 0) {
      throw new ConflictError(
        `service "${id}" still has ${spaces.length} space(s); delete them first or use force on each space`,
        spaces.length,
      );
    }
    this.db.prepare("DELETE FROM services WHERE id = ?").run(id);
  }

  // ---- spaces ----

  createSpace(input: { serviceId: string; name: string; metaJson?: string | undefined }): SpaceRow {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO spaces (id, service_id, name, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, input.serviceId, input.name, input.metaJson ?? "{}", now());
    return this.getSpace(id);
  }

  getSpace(id: string): SpaceRow {
    const row = this.db.prepare("SELECT * FROM spaces WHERE id = ?").get(id) as
      | { id: string; service_id: string; name: string; meta_json: string; created_at: string }
      | undefined;
    if (row === undefined) {
      throw new NotFoundError("space", id);
    }
    return {
      id: row.id,
      serviceId: row.service_id,
      name: row.name,
      metaJson: row.meta_json,
      createdAt: row.created_at,
    };
  }

  listSpaces(options: PageOptions & { serviceId?: string | undefined } = {}): Page<SpaceRow> {
    const extraWhere = options.serviceId !== undefined ? " AND service_id = ?" : "";
    const binds = options.serviceId !== undefined ? [options.serviceId] : [];
    const { rows, nextCursor } = pageQuery(this.db, "spaces", options, extraWhere, binds);
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        serviceId: String(r.service_id),
        name: String(r.name),
        metaJson: String(r.meta_json),
        createdAt: String(r.created_at),
      })),
      nextCursor,
    };
  }

  patchSpace(id: string, patch: { name?: string | undefined; metaJson?: string | undefined }): SpaceRow {
    this.getSpace(id);
    if (patch.name !== undefined) {
      this.db.prepare("UPDATE spaces SET name = ? WHERE id = ?").run(patch.name, id);
    }
    if (patch.metaJson !== undefined) {
      this.db.prepare("UPDATE spaces SET meta_json = ? WHERE id = ?").run(patch.metaJson, id);
    }
    return this.getSpace(id);
  }

  /** Children count used for the non-force delete conflict. */
  countSpaceChildren(spaceId: string): number {
    const agents = (
      this.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE space_id = ?").get(spaceId) as {
        n: number;
      }
    ).n;
    const facts = (
      this.db.prepare("SELECT COUNT(*) AS n FROM l1_facts WHERE space_id = ?").get(spaceId) as {
        n: number;
      }
    ).n;
    const scenarios = (
      this.db.prepare("SELECT COUNT(*) AS n FROM l2_scenarios WHERE space_id = ?").get(spaceId) as {
        n: number;
      }
    ).n;
    return agents + facts + scenarios;
  }

  deleteSpace(id: string, options: { force?: boolean }): void {
    this.getSpace(id);
    const children = this.countSpaceChildren(id);
    if (options.force !== true && children > 0) {
      throw new ConflictError(
        `space "${id}" has ${children} child record(s); retry with force to cascade delete`,
        children,
      );
    }
    const cascade = this.db.transaction(() => {
      const agentIds = this.db
        .prepare("SELECT id FROM agents WHERE space_id = ?")
        .all(id) as Array<{ id: string }>;
      const factIds = this.db
        .prepare("SELECT id FROM l1_facts WHERE space_id = ?")
        .all(id) as Array<{ id: string }>;
      const sessionIds: string[] = [];
      for (const agent of agentIds) {
        const rows = this.db
          .prepare("SELECT id FROM sessions WHERE agent_id = ?")
          .all(agent.id) as Array<{ id: string }>;
        for (const row of rows) {
          sessionIds.push(row.id);
        }
      }
      for (const sessionId of sessionIds) {
        this.db.prepare("DELETE FROM l0_messages WHERE session_id = ?").run(sessionId);
        this.db.prepare("DELETE FROM injections WHERE session_id = ?").run(sessionId);
        this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      }
      for (const fact of factIds) {
        this.db.prepare("DELETE FROM l1_fact_entities WHERE fact_id = ?").run(fact.id);
        this.db.prepare("DELETE FROM l1_facts_fts WHERE fact_id = ?").run(fact.id);
      }
      const vecTables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_facts_%'")
        .all() as Array<{ name: string }>;
      for (const table of vecTables) {
        for (const fact of factIds) {
          this.db.prepare(`DELETE FROM "${table.name}" WHERE fact_id = ?`).run(fact.id);
        }
      }
      this.db.prepare("DELETE FROM l1_facts WHERE space_id = ?").run(id);
      this.db.prepare("DELETE FROM entities WHERE space_id = ?").run(id);
      this.db.prepare("DELETE FROM l2_scenarios WHERE space_id = ?").run(id);
      this.db.prepare("DELETE FROM skills WHERE space_id = ?").run(id);
      this.db.prepare("DELETE FROM knowledge WHERE space_id = ?").run(id);
      this.db.prepare("DELETE FROM l3_profiles WHERE scope_key = ?").run(`space:${id}`);
      this.db.prepare("DELETE FROM agents WHERE space_id = ?").run(id);
      this.db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
    });
    cascade();
  }

  // ---- agents ----

  createAgent(input: { spaceId: string; kind: string; name: string }): AgentRow {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO agents (id, space_id, kind, name) VALUES (?, ?, ?, ?)")
      .run(id, input.spaceId, input.kind, input.name);
    return this.getAgent(id);
  }

  getAgent(id: string): AgentRow {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | { id: string; space_id: string; kind: string; name: string }
      | undefined;
    if (row === undefined) {
      throw new NotFoundError("agent", id);
    }
    return { id: row.id, spaceId: row.space_id, kind: row.kind, name: row.name };
  }

  listAgents(options: PageOptions & { spaceId?: string | undefined } = {}): Page<AgentRow> {
    const extraWhere = options.spaceId !== undefined ? " AND space_id = ?" : "";
    const binds = options.spaceId !== undefined ? [options.spaceId] : [];
    const { rows, nextCursor } = pageQuery(this.db, "agents", options, extraWhere, binds);
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        spaceId: String(r.space_id),
        kind: String(r.kind),
        name: String(r.name),
      })),
      nextCursor,
    };
  }

  patchAgent(id: string, patch: { name?: string | undefined; kind?: string | undefined }): AgentRow {
    this.getAgent(id);
    if (patch.name !== undefined) {
      this.db.prepare("UPDATE agents SET name = ? WHERE id = ?").run(patch.name, id);
    }
    if (patch.kind !== undefined) {
      this.db.prepare("UPDATE agents SET kind = ? WHERE id = ?").run(patch.kind, id);
    }
    return this.getAgent(id);
  }

  deleteAgent(id: string): void {
    this.getAgent(id);
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }
}
