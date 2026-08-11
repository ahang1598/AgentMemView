import type { AgentMemViewDatabase } from "../db/database.js";

/**
 * Entity boost (Spec section 6 stage 4): facts linked to an entity whose
 * name/alias appears in the query get +0.1. Link mode per mem0 conventions.
 */

/** Fact ids in the space linked to entities mentioned in the query. */
export function entityBoostedFactIds(
  db: AgentMemViewDatabase,
  spaceId: string,
  query: string,
): Set<string> {
  const lowered = query.toLowerCase();
  const entities = db
    .prepare("SELECT id, name, aliases_json FROM entities WHERE space_id = ?")
    .all(spaceId) as Array<{ id: string; name: string; aliases_json: string }>;
  const matchedEntityIds: string[] = [];
  for (const entity of entities) {
    const aliases: string[] = safeParse(entity.aliases_json);
    const terms = [entity.name, ...aliases];
    if (terms.some((term) => term.length > 0 && lowered.includes(term.toLowerCase()))) {
      matchedEntityIds.push(entity.id);
    }
  }
  const factIds = new Set<string>();
  if (matchedEntityIds.length === 0) {
    return factIds;
  }
  const lookup = db.prepare(`SELECT fact_id FROM l1_fact_entities WHERE entity_id = ?`);
  for (const entityId of matchedEntityIds) {
    const rows = lookup.all(entityId) as Array<{ fact_id: string }>;
    for (const row of rows) {
      factIds.add(row.fact_id);
    }
  }
  return factIds;
}

function safeParse(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
