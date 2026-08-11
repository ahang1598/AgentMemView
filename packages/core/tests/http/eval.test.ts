import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { createHttpApp } from "../../src/http/app.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeApp(): ReturnType<typeof createHttpApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-evalroute-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  return createHttpApp(db);
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("eval endpoints (M5-04)", () => {
  it("POST /eval/run enqueues a job; GET /eval/reports persists + lists", async () => {
    const app = makeApp();
    const runRes = await app.request("/api/v1/eval/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset: "longmemeval-s", sample: 20 }),
    });
    expect(runRes.status).toBe(201);
    const run = (await runRes.json()) as { runId: string; status: string };
    expect(run.status).toBe("queued");

    // simulate a finished run persisting its report
    const db = openDbs[openDbs.length - 1];
    db?.prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)").run(
      `eval.report.${run.runId}`,
      JSON.stringify({
        dataset: "longmemeval-s",
        runId: run.runId,
        metrics: { recallAt5: 0.91 },
      }),
    );
    const reportsRes = await app.request("/api/v1/eval/reports");
    expect(reportsRes.status).toBe(200);
    const body = (await reportsRes.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.runId).toBe(run.runId);
  });

  it("POST /eval/run validates dataset", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/eval/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
