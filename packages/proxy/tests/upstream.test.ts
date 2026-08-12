import { describe, expect, it } from "vitest";
import { resolveUpstreams } from "../src/server.js";

describe("resolveUpstreams", () => {
  it("upstreamBase wins for both protocols", () => {
    const out = resolveUpstreams({ coreBaseUrl: "x", upstreamBase: "http://gw" }, {});
    expect(out).toEqual({ anthropic: "http://gw", openai: "http://gw" });
  });

  it("per-protocol option beats env", () => {
    const out = resolveUpstreams(
      { coreBaseUrl: "x", upstreamAnthropic: "http://a" },
      { AGENTMEMVIEW_UPSTREAM_ANTHROPIC: "http://env-a", OPENAI_BASE_URL: "http://o" },
    );
    expect(out.anthropic).toBe("http://a");
    expect(out.openai).toBe("http://o");
  });

  it("dedicated env var used when no options", () => {
    const out = resolveUpstreams(
      { coreBaseUrl: "x" },
      { AGENTMEMVIEW_UPSTREAM_ANTHROPIC: "https://open.bigmodel.cn/api/anthropic" },
    );
    expect(out.anthropic).toBe("https://open.bigmodel.cn/api/anthropic");
  });

  it("falls back to the agent's ANTHROPIC_BASE_URL when it is not the proxy itself", () => {
    const out = resolveUpstreams(
      { coreBaseUrl: "x" },
      { ANTHROPIC_BASE_URL: "https://gw.example/api" },
    );
    expect(out.anthropic).toBe("https://gw.example/api");
  });

  it("ignores ANTHROPIC_BASE_URL when it points at the proxy (loop guard)", () => {
    const out = resolveUpstreams(
      { coreBaseUrl: "x" },
      { ANTHROPIC_BASE_URL: "http://127.0.0.1:8619/claude-code/default" },
    );
    expect(out.anthropic).toBe("https://api.anthropic.com");
  });

  it("defaults when nothing is configured", () => {
    const out = resolveUpstreams({ coreBaseUrl: "x" }, {});
    expect(out).toEqual({
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com",
    });
  });
});
