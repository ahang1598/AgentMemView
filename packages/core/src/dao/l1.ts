import { createHash } from "node:crypto";
import { AGENT_VISIBILITY_SQL } from "../scope/context.js";
import { ScopedDao } from "./base.js";

export type FactStatus = "active" | "superseded" | "forgotten";

/** Dedup window for identical content_hash within a space. */
export const DEDUP_WINDOW_MS = 5 * 60_000;

export interface FactRow {
  id: string;
  spaceId: string;
  agentId: string | null;
  content: string;
  contentHash: string;
  status: FactStatus;
  pinned: boolean;
  confidence: number;
  halfLifeDays: number;
  accessCount: number;
  lastAccessedAt: string;
  sourceMessageId: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreatedFact = FactRow & { deduped: boolean };

export interface CreateFactInput {
  content: string;
  /** Defaults to the DAO scope agent (space-shared when both absent). */
  agentId?: string | undefined;
  sourceMessageId?: string | undefined;
  confidence?: number | undefined;
  halfLifeDays?: number | undefined;
  pinned?: boolean | undefined;
}

export interface ListFactsOptions {
  /** Include superseded/forgotten rows; defaults to active only. */
  includeAllStatuses?: boolean | undefined;
  limit?: number | undefined;
}

/**
 * Secondary-index hook executed inside the same transaction as fact writes
 * (used by the retrieval engine to maintain vec tables).
 */
export interface FactIndexer {
  upsert(fact: FactRow): void;
  remove(factId: string): void;
}

interface FactDbRow {
  id: string;
  space_id: string;
  agent_id: string | null;
  content: string;
  content_hash: string;
  status: FactStatus;
  pinned: number;
  confidence: number;
  half_life_days: number;
  access_count: number;
  last_accessed_at: string;
  source_message_id: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function mapRow(row: FactDbRow): FactRow {
  return {
    id: row.id,
    spaceId: row.space_id,
    agentId: row.agent_id,
    content: row.content,
    contentHash: row.content_hash,
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
  };
}

/** L1 atomic-fact DAO. Every method filters by scope.space_id at minimum. */
export class FactsDao extends ScopedDao {
  constructor(
    db: ConstructorParameters<typeof ScopedDao>[0],
    scope: ConstructorParameters<typeof ScopedDao>[1],
    private readonly clock: () => number = Date.now,
    private readonly indexer?: FactIndexer,
  ) {
    super(db, scope);
  }

  /** Space + agent visibility WHERE clause for the current scope. */
  protected visibilityClause(): { sql: string; binds: Array<string | null> } {
    if (this.scope.agentId === undefined) {
      return { sql: "space_id = ?", binds: [this.scope.spaceId] };
    }
    return {
      sql: `space_id = ? AND ${AGENT_VISIBILITY_SQL}`,
      binds: [this.scope.spaceId, this.scope.agentId],
    };
  }

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  create(input: CreateFactInput): CreatedFact {
    const hash = contentHash(input.content);
    const windowStart = new Date(this.clock() - DEDUP_WINDOW_MS).toISOString();
    const dup = this.db
      .prepare(
        `SELECT id FROM l1_facts
         WHERE space_id = ? AND content_hash = ? AND status = 'active' AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(this.scope.spaceId, hash, windowStart) as { id: string } | undefined;
    if (dup !== undefined) {
      const existing = this.get(dup.id);
      if (existing !== undefined) {
        return { ...existing, deduped: true };
      }
    }
    const id = this.newId();
    const now = this.nowIso();
    const agentId = input.agentId ?? this.scope.agentId ?? null;
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO l1_facts (
            id, space_id, agent_id, content, content_hash, status, pinned,
            confidence, half_life_days, access_count, last_accessed_at,
            source_message_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.scope.spaceId,
          agentId,
          input.content,
          hash,
          input.pinned === true ? 1 : 0,
          input.confidence ?? 1,
          input.halfLifeDays ?? 30,
          now,
          input.sourceMessageId ?? null,
          now,
          now,
        );
      this.db
        .prepare("INSERT INTO l1_facts_fts (fact_id, content) VALUES (?, ?)")
        .run(id, input.content);
      const created = mapRow(
        this.db.prepare("SELECT * FROM l1_facts WHERE id = ?").get(id) as FactDbRow,
      );
      this.indexer?.upsert(created);
      return created;
    });
    return { ...insert(), deduped: false };
  }

  get(id: string): FactRow | undefined {
    const { sql, binds } = this.visibilityClause();
    const row = this.db
      .prepare(`SELECT * FROM l1_facts WHERE ${sql} AND id = ?`)
      .get(...binds, id) as FactDbRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  private getOrThrow(id: string): FactRow {
    const fact = this.get(id);
    if (fact === undefined) {
      throw new Error(`fact "${id}" not found in scope`);
    }
    return fact;
  }

  list(options: ListFactsOptions = {}): FactRow[] {
    const { sql, binds } = this.visibilityClause();
    const statusClause = options.includeAllStatuses === true ? "" : " AND status = 'active'";
    const limitClause = options.limit !== undefined ? " LIMIT ?" : "";
    const limitBinds: number[] = options.limit !== undefined ? [options.limit] : [];
    const rows = this.db
      .prepare(
        `SELECT * FROM l1_facts WHERE ${sql}${statusClause} ORDER BY created_at DESC${limitClause}`,
      )
      .all(...binds, ...limitBinds) as FactDbRow[];
    return rows.map(mapRow);
  }

  /**
   * Edit = supersede (AC-05): the old row is kept with status="superseded"
   * and superseded_by pointing at the new row; a fresh active row is created.
   */
  update(id: string, patch: { content: string; confidence?: number }): CreatedFact {
    const old = this.getOrThrow(id);
    if (old.status !== "active") {
      throw new Error(`fact "${id}" is ${old.status}; only active facts can be updated`);
    }
    const result = this.create({
      content: patch.content,
      agentId: old.agentId ?? undefined,
      sourceMessageId: old.sourceMessageId ?? undefined,
      confidence: patch.confidence ?? old.confidence,
      halfLifeDays: old.halfLifeDays,
      pinned: old.pinned,
    });
    const apply = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE l1_facts SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?",
        )
        .run(result.id, this.nowIso(), old.id);
      this.db.prepare("DELETE FROM l1_facts_fts WHERE fact_id = ?").run(old.id);
      this.indexer?.remove(old.id);
    });
    apply();
    return result;
  }

  /** Full supersede chain (oldest → newest) containing the given fact. */
  lineage(id: string): FactRow[] {
    let current = this.getOrThrow(id);
    // walk up to the root ancestor
    for (;;) {
      const parent = this.db
        .prepare("SELECT * FROM l1_facts WHERE superseded_by = ? AND space_id = ?")
        .get(current.id, this.scope.spaceId) as FactDbRow | undefined;
      if (parent === undefined) {
        break;
      }
      current = mapRow(parent);
    }
    // walk down the supersede chain
    const chain: FactRow[] = [current];
    let cursor = current;
    while (cursor.supersededBy !== null) {
      const next = this.get(cursor.supersededBy);
      if (next === undefined) {
        break;
      }
      chain.push(next);
      cursor = next;
    }
    return chain;
  }

  pin(id: string, pinned: boolean): FactRow {
    this.getOrThrow(id);
    this.db
      .prepare("UPDATE l1_facts SET pinned = ?, updated_at = ? WHERE id = ?")
      .run(pinned ? 1 : 0, this.nowIso(), id);
    return this.getOrThrow(id);
  }

  forget(id: string): FactRow {
    this.getOrThrow(id);
    const apply = this.db.transaction(() => {
      this.db
        .prepare("UPDATE l1_facts SET status = 'forgotten', updated_at = ? WHERE id = ?")
        .run(this.nowIso(), id);
      this.db.prepare("DELETE FROM l1_facts_fts WHERE fact_id = ?").run(id);
      this.indexer?.remove(id);
    });
    apply();
    return this.getOrThrow(id);
  }

  /** forgotten → active; the observable narrative keeps the row recoverable. */
  recover(id: string): FactRow {
    const fact = this.getOrThrow(id);
    if (fact.status !== "forgotten") {
      throw new Error(`fact "${id}" is ${fact.status}; only forgotten facts can be recovered`);
    }
    const apply = this.db.transaction(() => {
      this.db
        .prepare("UPDATE l1_facts SET status = 'active', updated_at = ? WHERE id = ?")
        .run(this.nowIso(), id);
      this.db
        .prepare("INSERT INTO l1_facts_fts (fact_id, content) VALUES (?, ?)")
        .run(fact.id, fact.content);
      this.indexer?.upsert(fact);
    });
    apply();
    return this.getOrThrow(id);
  }

  touch(id: string): FactRow {
    this.getOrThrow(id);
    this.db
      .prepare(
        "UPDATE l1_facts SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
      )
      .run(this.nowIso(), id);
    return this.getOrThrow(id);
  }
}
