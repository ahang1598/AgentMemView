import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forwardRequest } from "../../src/upstream/forward.js";
import { type MockUpstream, startMockUpstream } from "../mockup/server.js";

let upstream: MockUpstream;

beforeEach(async () => {
  upstream = await startMockUpstream();
});

afterEach(async () => {
  await upstream.close();
});

describe("upstream forwarder (M2-03)", () => {
  it("forwards with stripped internal headers", async () => {
    upstream.enqueue({ body: JSON.stringify({ ok: true }) });
    const res = await forwardRequest({
      url: `${upstream.url}/v1/messages`,
      method: "POST",
      body: JSON.stringify({ model: "m" }),
      headers: {
        "content-type": "application/json",
        "x-agentmemview-key": "local-key",
        "x-agentmemview-session": "sess-1",
        "x-api-key": "user-upstream-key",
        host: "should-be-rewritten",
      },
    });
    expect(res.status).toBe(200);
    const req = upstream.captured[0];
    expect(req).toBeDefined();
    expect(req?.headers["x-agentmemview-key"]).toBeUndefined();
    expect(req?.headers["x-agentmemview-session"]).toBeUndefined();
    // user's upstream credential passes through
    expect(req?.headers["x-api-key"]).toBe("user-upstream-key");
    // host rewritten to the upstream target
    expect(req?.headers.host).toContain("127.0.0.1");
    expect(req?.body).toBe(JSON.stringify({ model: "m" }));
  });

  it("retries on 429/500 to retryTarget once", async () => {
    upstream.enqueue({ status: 429, body: JSON.stringify({ error: "rate limited" }) });
    upstream.enqueue({ body: JSON.stringify({ ok: "second-try" }) });
    const res = await forwardRequest({
      url: `${upstream.url}/v1/messages`,
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ ok: "second-try" }));
    expect(upstream.captured).toHaveLength(2);
  });

  it("does not retry on 400", async () => {
    upstream.enqueue({ status: 400, body: JSON.stringify({ error: "bad request" }) });
    const res = await forwardRequest({
      url: `${upstream.url}/v1/messages`,
      method: "POST",
      body: "{}",
      headers: {},
    });
    expect(res.status).toBe(400);
    expect(upstream.captured).toHaveLength(1);
  });

  it("timeout aborts at configured ms", async () => {
    upstream.enqueue({ body: "{}", delayMs: 800 });
    await expect(
      forwardRequest({
        url: `${upstream.url}/v1/messages`,
        method: "POST",
        body: "{}",
        headers: {},
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/timeout|abort/i);
  });
});
