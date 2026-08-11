import { redact } from "@agentmemview/core";

/**
 * L0 write-back client (Spec section 7 stage 8): fire-and-forget POST to
 * core with bounded exponential backoff. Observation failures never block
 * the business response path (fail-open); exhausted retries dead-letter in
 * memory for the shutdown drain to report.
 */

export interface WriteMessage {
  turn: number;
  role: string;
  content: string;
}

export interface WritePayload {
  sessionId: string;
  messages: WriteMessage[];
}

export interface L0ClientOptions {
  coreBaseUrl: string;
  /** Backoff schedule per retry; length = max retries. Default [200,800,2400]. */
  backoffMs?: number[] | undefined;
}

const DEFAULT_BACKOFF_MS = [200, 800, 2400];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class L0Client {
  readonly #coreBaseUrl: string;
  readonly #backoffMs: number[];
  readonly #inflight = new Set<Promise<void>>();
  readonly deadLetters: WritePayload[] = [];

  constructor(options: L0ClientOptions) {
    this.#coreBaseUrl = options.coreBaseUrl.replace(/\/$/, "");
    this.#backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  /** Fire-and-forget: returns immediately, never throws into the caller. */
  enqueue(payload: WritePayload): void {
    const sanitized: WritePayload = {
      sessionId: payload.sessionId,
      messages: payload.messages.map((message) => ({
        turn: message.turn,
        role: message.role,
        content: redact(message.content).text,
      })),
    };
    const task = this.#deliver(sanitized);
    this.#inflight.add(task);
    void task.finally(() => {
      this.#inflight.delete(task);
    });
  }

  /** Await all in-flight writes (graceful shutdown drain). */
  async drain(): Promise<void> {
    while (this.#inflight.size > 0) {
      await Promise.allSettled([...this.#inflight]);
    }
  }

  async #deliver(payload: WritePayload): Promise<void> {
    const url = `${this.#coreBaseUrl}/api/v1/l0/messages`;
    const body = JSON.stringify(payload);
    const attempts = this.#backoffMs.length + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (res.ok) {
          await res.arrayBuffer().catch(() => undefined);
          return;
        }
        await res.arrayBuffer().catch(() => undefined);
      } catch {
        // network failure: fall through to backoff
      }
      const delay = this.#backoffMs[attempt];
      if (delay === undefined) {
        break;
      }
      await sleep(delay);
    }
    this.deadLetters.push(payload);
  }
}
