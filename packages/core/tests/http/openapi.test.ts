import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { createHttpApp } from "../../src/http/app.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("openapi.yaml consistency (M2-12)", () => {
  it("yaml path set equals registered route set", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-openapi-"));
    tempDirs.push(dir);
    const db = openDatabase(path.join(dir, "agentmemview.db"));
    openDbs.push(db);
    migrate(db);
    const app = createHttpApp(db);

    const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../openapi.yaml");
    const spec = parse(readFileSync(specPath, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const specRoutes = new Set<string>();
    for (const [rawPath, methods] of Object.entries(spec.paths)) {
      const honoPath = rawPath.replace(/\{([^}]+)\}/g, ":$1");
      for (const method of Object.keys(methods)) {
        specRoutes.add(`${method.toUpperCase()} ${honoPath}`);
      }
    }

    const appRoutes = new Set<string>();
    for (const route of app.routes) {
      if (route.method === "ALL") {
        continue; // middleware, not a REST route
      }
      appRoutes.add(`${route.method} ${route.path}`);
    }
    expect(appRoutes).toContain("GET /api/v1/health");

    const missingInApp = [...specRoutes].filter((r) => !appRoutes.has(r));
    const missingInSpec = [...appRoutes].filter((r) => !specRoutes.has(r));
    expect(missingInApp).toEqual([]);
    expect(missingInSpec).toEqual([]);
  });
});
