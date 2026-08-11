import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMemViewDatabase } from "./database.js";

/** Thrown when a migration file fails to apply; the transaction is rolled back. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Migrations bundled next to the compiled/source migrator (`db/migrations`). */
export function defaultMigrationsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
}

/**
 * Version-chain migrator: scans `*.sql` files sorted by filename, applies each
 * pending one inside a transaction and records it in `schema_migrations`.
 * Returns the versions applied by this call (empty when up to date).
 */
export function migrate(db: AgentMemViewDatabase, migrationsDir?: string): string[] {
  const dir = migrationsDir ?? defaultMigrationsDir();
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );

  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>).map(
      (row) => row.version,
    ),
  );

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.slice(0, -".sql".length);
    if (applied.has(version)) {
      continue;
    }
    const sql = readFileSync(path.join(dir, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    });
    try {
      apply();
    } catch (err) {
      throw new MigrationError(`migration ${version} failed: ${(err as Error).message}`);
    }
    newlyApplied.push(version);
  }
  return newlyApplied;
}
