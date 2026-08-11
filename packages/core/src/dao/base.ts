import { randomUUID } from "node:crypto";
import type { AgentMemViewDatabase } from "../db/database.js";
import { type Scope, validateScope } from "../scope/context.js";

/**
 * Base class for all scoped DAOs. Construction without a valid scope throws
 * ScopeRequiredError; subclasses must bind `space_id` (and agent visibility)
 * in every query — bare cross-space queries are structurally impossible.
 */
export abstract class ScopedDao {
  protected readonly db: AgentMemViewDatabase;
  protected readonly scope: Scope;

  constructor(db: AgentMemViewDatabase, scope: Scope) {
    this.db = db;
    this.scope = validateScope(scope);
  }

  protected newId(): string {
    return randomUUID();
  }

  protected now(): string {
    return new Date().toISOString();
  }

  /**
   * Bind parameters for the shared visibility clause
   * `space_id = ? AND (agent_id IS NULL OR agent_id = ?)`.
   * With a space-wide scope (no agentId) pass null: agent-scoped rows stay
   * visible in space-wide listings, matching "agent null means space-shared".
   */
  protected agentVisibilityBind(): string | null {
    return this.scope.agentId ?? null;
  }
}
