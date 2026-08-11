import type { AgentMemViewDatabase } from "../db/database.js";
import type { JobQueue, JobRow } from "./queue.js";

/**
 * Polling worker: claims due jobs (atomic UPDATE), executes registered
 * handlers with bounded concurrency, marks done/failed. Handler errors are
 * funneled into the queue's backoff/DLQ machinery.
 */

export type JobHandler = (payload: Record<string, unknown>, job: JobRow) => Promise<void>;

export interface JobWorkerOptions {
  pollMs?: number | undefined;
  concurrency?: number | undefined;
}

export class JobWorker {
  readonly #handlers = new Map<string, JobHandler>();
  readonly #pollMs: number;
  readonly #concurrency: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #inflight = 0;

  constructor(
    private readonly db: AgentMemViewDatabase,
    private readonly queue: JobQueue,
    options: JobWorkerOptions = {},
  ) {
    this.#pollMs = options.pollMs ?? 500;
    this.#concurrency = options.concurrency ?? 2;
    void this.db; // db reserved for future scoped queries
  }

  register(type: string, handler: JobHandler): void {
    this.#handlers.set(type, handler);
  }

  start(): void {
    if (this.#timer !== null) {
      return;
    }
    this.queue.recoverRunning();
    this.#timer = setInterval(() => {
      this.#tick();
    }, this.#pollMs);
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #tick(): void {
    const free = this.#concurrency - this.#inflight;
    if (free <= 0) {
      return;
    }
    const jobs = this.queue.claim(free);
    for (const job of jobs) {
      this.#inflight += 1;
      void this.#run(job).finally(() => {
        this.#inflight -= 1;
      });
    }
  }

  async #run(job: JobRow): Promise<void> {
    const handler = this.#handlers.get(job.type);
    if (handler === undefined) {
      this.queue.markFailed(job.id, `no handler registered for ${job.type}`);
      return;
    }
    try {
      await handler(job.payload, job);
      this.queue.markDone(job.id);
    } catch (err) {
      this.queue.markFailed(job.id, (err as Error).message);
    }
  }
}
