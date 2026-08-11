import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../../src/ratelimit/guard.js";

describe("rate limit guard (M2-08, fail-open)", () => {
  it("exceeds qpm → 429 with retry-after", () => {
    const limiter = new SlidingWindowLimiter({ qpm: 3, windowMs: 60_000 });
    const now = 1_000_000;
    expect(limiter.tryAcquire("space:model", now).allowed).toBe(true);
    expect(limiter.tryAcquire("space:model", now + 1).allowed).toBe(true);
    expect(limiter.tryAcquire("space:model", now + 2).allowed).toBe(true);
    const denied = limiter.tryAcquire("space:model", now + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    // other keys unaffected
    expect(limiter.tryAcquire("other:model", now + 3).allowed).toBe(true);
  });

  it("window slides", () => {
    const limiter = new SlidingWindowLimiter({ qpm: 2, windowMs: 1000 });
    const t0 = 5000;
    expect(limiter.tryAcquire("k", t0).allowed).toBe(true);
    expect(limiter.tryAcquire("k", t0 + 100).allowed).toBe(true);
    expect(limiter.tryAcquire("k", t0 + 200).allowed).toBe(false);
    // after the first hit slides out of the window, capacity returns
    expect(limiter.tryAcquire("k", t0 + 1100).allowed).toBe(true);
  });

  it("fail-open on internal error", () => {
    const limiter = new SlidingWindowLimiter({
      qpm: 1,
      windowMs: 60_000,
      clockOverride: () => {
        throw new Error("clock exploded");
      },
    });
    const warnings: string[] = [];
    const result = limiter.tryAcquire("k", undefined, (msg) => warnings.push(msg));
    expect(result.allowed).toBe(true);
    expect(warnings.length).toBe(1);
  });
});
