/**
 * Scope context — the tenancy envelope every DAO query must live inside.
 * Spec section 4: DAO layer enforces scope filtering, bare queries forbidden.
 */

export interface Scope {
  serviceId: string;
  spaceId: string;
  /** When absent, the scope is space-wide (all agents visible). */
  agentId?: string;
}

export class ScopeRequiredError extends Error {
  constructor(message = "scope is required: every DAO query must carry serviceId/spaceId") {
    super(message);
    this.name = "ScopeRequiredError";
  }
}

/** Validate a scope at runtime; throws ScopeRequiredError when unusable. */
export function validateScope(scope: Scope): Scope {
  if (!scope || typeof scope !== "object") {
    throw new ScopeRequiredError();
  }
  if (typeof scope.serviceId !== "string" || scope.serviceId.length === 0) {
    throw new ScopeRequiredError("scope.serviceId is required");
  }
  if (typeof scope.spaceId !== "string" || scope.spaceId.length === 0) {
    throw new ScopeRequiredError("scope.spaceId is required");
  }
  return scope;
}

/**
 * SQL fragment enforcing agent visibility:
 * agent_id IS NULL rows are space-shared and visible to every agent scope.
 */
export const AGENT_VISIBILITY_SQL = "(agent_id IS NULL OR agent_id = ?)";
