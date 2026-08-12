import { describe, expect, it } from "vitest";
import { startProxyServer } from "../src/server.js";

describe("startProxyServer", () => {
  it("binds a port, serves /health, and closes cleanly", async () => {
    const running = await startProxyServer({
      coreBaseUrl: "http://127.0.0.1:59999",
      port: 0,
      host: "127.0.0.1",
      upstreamAnthropic: "https://gw.example",
      upstreamOpenai: "https://gw2.example",
    });
    expect(running.upstreams).toEqual({
      anthropic: "https://gw.example",
      openai: "https://gw2.example",
    });
    const address = running.port;
    expect(address).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${address}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await running.close();
  });
});
