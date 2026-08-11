/**
 * In-memory sliding-window rate limiter (Spec section 7 stage 5).
 * fail-open discipline: any internal error allows the request through and
 * emits a warning — limiting must never break the business path.
 */

export interface LimiterOptions {
  qpm: number;
  windowMs?: number | undefined;
  clockOverride?: (() => number) | undefined;
}

export interface AcquireResult {
  allowed: boolean;
  retryAfterSec?: number | undefined;
}

const DEFAULT_WINDOW_MS = 60_000;

export class SlidingWindowLimiter {
  readonly #qpm: number;
  readonly #windowMs: number;
  readonly #clock: () => number;
  readonly #hits = new Map<string, number[]>();

  constructor(options: LimiterOptions) {
    this.#qpm = options.qpm;
    this.#windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.#clock = options.clockOverride ?? Date.now;
  }

  tryAcquire(
    key: string,
    nowMs?: number | undefined,
    onWarn?: ((message: string) => void) | undefined,
  ): AcquireResult {
    try {
      const now = nowMs ?? this.#clock();
      const windowStart = now - this.#windowMs;
      const hits = (this.#hits.get(key) ?? []).filter((t) => t > windowStart);
      if (hits.length >= this.#qpm) {
        const oldest = hits[0] ?? now;
        const retryAfterSec = Math.max(1, Math.ceil((oldest + this.#windowMs - now) / 1000));
        this.#hits.set(key, hits);
        return { allowed: false, retryAfterSec };
      }
      hits.push(now);
      this.#hits.set(key, hits);
      return { allowed: true };
    } catch (err) {
      onWarn?.(`ratelimit internal error, failing open: ${(err as Error).message}`);
      return { allowed: true };
    }
  }
}
