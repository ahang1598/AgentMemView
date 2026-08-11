import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { JobQueue } from "../../src/jobs/queue.js";
import { JobWorker } from "../../src/jobs/worker.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeDb(): AgentMemViewDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-jobs-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe("job queue (M4-01)", () => {
  it("enqueue then worker executes and marks done", async () => {
    const db = makeDb();
    const clock = { now: Date.now() };
    const queue = new JobQueue(db, { nowMs: () => clock.now });
    const worker = new JobWorker(db, queue, { pollMs: 10 });
    const seen: Array<Record<string, unknown>> = [];
    worker.register("test.echo", async (payload) => {
      seen.push(payload);
    });
    worker.start();
    queue.enqueue("test.echo", { hello: "world" });
    await sleep(120);
    worker.stop();
    expect(seen).toEqual([{ hello: "world" }]);
    const row = db.prepare("SELECT status FROM jobs").get() as { status: string };
    expect(row.status).toBe("done");
  });

  it("failure retries with backoff then moves to dlq", async () => {
    const db = makeDb();
    const clock = { now: 1_000_000 };
    const queue = new JobQueue(db, { nowMs: () => clock.now, backoffBaseMs: 100 });
    const id = queue.enqueue("test.fail", { x: 1 });

    // attempt 1 fails → pending again, run_after = now + 100
    queue.markFailedForTest(id, "boom");
    let job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as {
      status: string;
      attempts: number;
      run_after: string;
    };
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(Date.parse(job.run_after)).toBe(clock.now + 100);

    // attempt 2 → backoff doubles
    clock.now += 200;
    queue.markFailedForTest(id, "boom2");
    job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as {
      status: string;
      attempts: number;
      run_after: string;
    };
    expect(job.attempts).toBe(2);
    expect(Date.parse(job.run_after)).toBe(clock.now + 200);

    // exhaust maxAttempts → dead letter
    clock.now += 400;
    queue.markFailedForTest(id, "boom3");
    const dead = db.prepare("SELECT * FROM jobs_dlq WHERE id = ?").get(id) as
      | { last_error: string }
      | undefined;
    expect(dead).toBeDefined();
    expect(dead?.last_error).toBe("boom3");
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE id = ?").get(id) as {
      n: number;
    };
    expect(remaining.n).toBe(0);
  });

  it("crash recovery resets running jobs to pending", () => {
    const db = makeDb();
    const queue = new JobQueue(db);
    queue.enqueue("test.stuck", {});
    // simulate crash: job left in running state
    db.prepare("UPDATE jobs SET status = 'running'").run();
    const recovered = queue.recoverRunning();
    expect(recovered).toBe(1);
    const row = db.prepare("SELECT status FROM jobs").get() as { status: string };
    expect(row.status).toBe("pending");
  });

  it("concurrency limit respected", async () => {
    const db = makeDb();
    const queue = new JobQueue(db);
    const worker = new JobWorker(db, queue, { pollMs: 5, concurrency: 2 });
    let current = 0;
    let maxSeen = 0;
    worker.register("test.slow", async () => {
      current += 1;
      maxSeen = Math.max(maxSeen, current);
      await sleep(30);
      current -= 1;
    });
    worker.start();
    for (let i = 0; i < 8; i += 1) {
      queue.enqueue("test.slow", { i });
    }
    await sleep(400);
    worker.stop();
    expect(maxSeen).toBeLessThanOrEqual(2);
    const done = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").get() as {
      n: number;
    };
    expect(done.n).toBe(8);
  });
});
