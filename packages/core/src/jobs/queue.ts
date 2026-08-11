import { randomUUID } from "node:crypto";
import type { AgentMemViewDatabase } from "../db/database.js";

/**
 * SQLite-backed job queue (tables jobs/jobs_dlq from 0002). Workers claim
 * jobs atomically; failures retry with exponential backoff until
 * maxAttempts, then move to the dead-letter table.
 */

export interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "dead";
  attempts: number;
  runAfter: string;
  lastError: string | null;
}

export interface JobQueueOptions {
  nowMs?: (() => number) | undefined;
  backoffBaseMs?: number | undefined;
  maxAttempts?: number | undefined;
}

export interface EnqueueOptions {
  runAfterMs?: number | undefined;
}

const DEFAULT_BACKOFF_BASE_MS = 200;
const DEFAULT_MAX_ATTEMPTS = 3;

export class JobQueue {
  readonly #nowMs: () => number;
  readonly #backoffBaseMs: number;
  readonly #maxAttempts: number;

  constructor(
    private readonly db: AgentMemViewDatabase,
    options: JobQueueOptions = {},
  ) {
    this.#nowMs = options.nowMs ?? Date.now;
    this.#backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  enqueue(type: string, payload: Record<string, unknown>, options: EnqueueOptions = {}): string {
    const id = randomUUID();
    const nowIso = new Date(this.#nowMs()).toISOString();
    const runAfter = new Date(this.#nowMs() + (options.runAfterMs ?? 0)).toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, type, payload_json, status, attempts, run_after, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
      )
      .run(id, type, JSON.stringify(payload), runAfter, nowIso, nowIso);
    return id;
  }

  /** Atomically claim due pending jobs for this worker. */
  claim(limit: number): JobRow[] {
    const nowIso = new Date(this.#nowMs()).toISOString();
    const rows = this.db
      .prepare(
        `SELECT id FROM jobs WHERE status = 'pending' AND run_after <= ?
         ORDER BY run_after ASC LIMIT ?`,
      )
      .all(nowIso, limit) as Array<{ id: string }>;
    const claimed: JobRow[] = [];
    const mark = this.db.prepare(
      `UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`,
    );
    for (const row of rows) {
      const result = mark.run(new Date(this.#nowMs()).toISOString(), row.id);
      if (result.changes > 0) {
        const job = this.get(row.id);
        if (job !== undefined) {
          claimed.push(job);
        }
      }
    }
    return claimed;
  }

  get(id: string): JobRow | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | {
          id: string;
          type: string;
          payload_json: string;
          status: JobRow["status"];
          attempts: number;
          run_after: string;
          last_error: string | null;
        }
      | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      status: row.status,
      attempts: row.attempts,
      runAfter: row.run_after,
      lastError: row.last_error,
    };
  }

  markDone(id: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?")
      .run(new Date(this.#nowMs()).toISOString(), id);
  }

  /** Record a failed attempt: reschedule with exponential backoff or dead-letter. */
  markFailed(id: string, error: string): void {
    const job = this.get(id);
    if (job === undefined) {
      return;
    }
    const attempts = job.attempts + 1;
    const nowIso = new Date(this.#nowMs()).toISOString();
    if (attempts >= this.#maxAttempts) {
      const move = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO jobs_dlq (id, type, payload_json, attempts, last_error, dead_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, job.type, JSON.stringify(job.payload), attempts, error, nowIso);
        this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
      });
      move();
      return;
    }
    const backoff = this.#backoffBaseMs * 2 ** (attempts - 1);
    const runAfter = new Date(this.#nowMs() + backoff).toISOString();
    this.db
      .prepare(
        `UPDATE jobs SET status = 'pending', attempts = ?, run_after = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(attempts, runAfter, error, nowIso, id);
  }

  /** Test hook with identical semantics to markFailed. */
  markFailedForTest(id: string, error: string): void {
    this.markFailed(id, error);
  }

  /** Watchdog: reset jobs stuck in running after a crash. */
  recoverRunning(): number {
    const result = this.db
      .prepare("UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'running'")
      .run(new Date(this.#nowMs()).toISOString());
    return result.changes;
  }

  list(limit = 100): JobRow[] {
    const rows = this.db
      .prepare("SELECT id FROM jobs ORDER BY rowid DESC LIMIT ?")
      .all(limit) as Array<{ id: string }>;
    return rows.map((r) => this.get(r.id)).filter((j): j is JobRow => j !== undefined);
  }
}
