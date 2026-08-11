import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export type MemokitDatabase = InstanceType<typeof Database>;

/**
 * Open the single-file SQLite database with the MemoKit baseline pragmas:
 * - WAL journal mode (concurrent reads while writing)
 * - foreign keys enforced
 * - sqlite-vec extension loaded for vector search
 *
 * Throws when the sqlite-vec native binary cannot be loaded; the CLI doctor
 * command (M0-06) translates that into actionable guidance.
 */
export function openDatabase(path: string): MemokitDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
  return db;
}
