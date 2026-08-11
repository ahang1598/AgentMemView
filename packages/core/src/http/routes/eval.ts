import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { JobQueue } from "../../jobs/queue.js";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/**
 * Eval endpoints (M5-04): POST /eval/run enqueues a scoring job through the
 * M4 queue; GET /eval/reports lists persisted reports (config table).
 */

const runBody = z.object({
  dataset: z.string().min(1),
  sample: z.number().int().min(1).optional(),
});

export const evalRoutes = new Hono<HttpEnv>()
  .post("/eval/run", validate("json", runBody), (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");
    const runId = randomUUID();
    const queue = new JobQueue(db);
    const jobId = queue.enqueue("eval.run", {
      runId,
      dataset: body.dataset,
      ...(body.sample !== undefined ? { sample: body.sample } : {}),
    });
    db.prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)").run(
      `eval.run.${runId}`,
      JSON.stringify({
        runId,
        dataset: body.dataset,
        jobId,
        status: "queued",
        queuedAt: new Date().toISOString(),
      }),
    );
    return c.json({ runId, jobId, status: "queued" }, 201);
  })
  .get("/eval/reports", (c) => {
    const db = c.get("db");
    const rows = db
      .prepare("SELECT key, value_json FROM config WHERE key LIKE 'eval.report.%'")
      .all() as Array<{ key: string; value_json: string }>;
    const items = rows
      .map((row) => {
        try {
          return JSON.parse(row.value_json) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== undefined);
    return c.json({ items });
  });
