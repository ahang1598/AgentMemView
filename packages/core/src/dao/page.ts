import type { AgentMemViewDatabase } from "../db/database.js";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageOptions {
  limit?: number | undefined;
  /** Cursor = id of the last item of the previous page (rowid ordered). */
  cursor?: string | undefined;
}

export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Stable cursor pagination over a table ordered by rowid. Table names are
 * internal constants only (never user input); all dynamic values are bound.
 */
export function pageQuery(
  db: AgentMemViewDatabase,
  table: string,
  options: PageOptions,
  extraWhere = "",
  binds: Array<string | number> = [],
): { rows: Array<Record<string, unknown>>; nextCursor: string | null } {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, 200);
  const cursorClause = options.cursor
    ? ` AND rowid > (SELECT rowid FROM ${table} WHERE id = ?)`
    : "";
  const cursorBinds = options.cursor ? [options.cursor] : [];
  const rows = db
    .prepare(
      `SELECT * FROM ${table} WHERE 1=1${extraWhere}${cursorClause} ORDER BY rowid ASC LIMIT ?`,
    )
    .all(...binds, ...cursorBinds, limit + 1) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    rows: items,
    nextCursor: hasMore && last !== undefined ? String(last.id) : null,
  };
}
