import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { MigrationError, migrate } from "../../src/db/migrator.js";

const sourceMigrations = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/db/migrations",
);

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memokit-migrate-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function listTables(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe("migrate", () => {
  it("applies migrations in order and records version", () => {
    const dir = makeTempDir();
    const db = openDatabase(path.join(dir, "memokit.db"));
    try {
      const applied = migrate(db);
      expect(applied).toContain("0001_init");
      const rows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: string;
      }>;
      expect(rows.map((r) => r.version)).toContain("0001_init");
    } finally {
      db.close();
    }
  });

  it("migrate is idempotent", () => {
    const dir = makeTempDir();
    const db = openDatabase(path.join(dir, "memokit.db"));
    try {
      const first = migrate(db);
      const second = migrate(db);
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual([]);
      const rows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: string;
      }>;
      expect(rows).toHaveLength(new Set(rows.map((r) => r.version)).size);
    } finally {
      db.close();
    }
  });

  it("0001 creates tenant tables", () => {
    const dir = makeTempDir();
    const db = openDatabase(path.join(dir, "memokit.db"));
    try {
      migrate(db);
      const tables = listTables(db);
      for (const expected of ["services", "spaces", "agents", "sessions", "events"]) {
        expect(tables).toContain(expected);
      }
      expect(tables).toContain("schema_migrations");
    } finally {
      db.close();
    }
  });

  it("rolls back on bad migration", () => {
    const dir = makeTempDir();
    const migrationsDir = path.join(dir, "migrations");
    cpSync(sourceMigrations, migrationsDir, { recursive: true });
    // Side effect to prove the transaction is rolled back as a whole.
    writeFileSync(
      path.join(migrationsDir, "0002_bad.sql"),
      "CREATE TABLE should_not_exist (id INTEGER);\nTHIS IS NOT VALID SQL;\n",
      "utf8",
    );

    const db = openDatabase(path.join(dir, "memokit.db"));
    try {
      expect(() => migrate(db, migrationsDir)).toThrow(MigrationError);
      // Version did not advance past 0001.
      const rows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: string;
      }>;
      expect(rows.map((r) => r.version)).not.toContain("0002_bad");
      // Partial statement effects were rolled back.
      expect(listTables(db)).not.toContain("should_not_exist");
    } finally {
      db.close();
    }
  });
});
