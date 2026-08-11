import { describe, expect, it } from "vitest";
import { checkAccessKey } from "../src/auth.js";
import { classifyRequestBody } from "../src/classify.js";
import { parseProxyRoute } from "../src/routing.js";
import { createProxyApp } from "../src/server.js";

describe("proxy routing (M2-01)", () => {
  it("parses /{agent}/{spaceId}/v1/messages", () => {
    const route = parseProxyRoute("/claude-code/space-1/v1/messages");
    expect(route).toEqual({ protocol: "anthropic", agent: "claude-code", spaceId: "space-1" });
    const openai = parseProxyRoute("/codex/space-2/v1/chat/completions");
    expect(openai).toEqual({ protocol: "openai", agent: "codex", spaceId: "space-2" });
  });

  it("bare /v1/* paths map to the default space", () => {
    expect(parseProxyRoute("/v1/messages")).toEqual({
      protocol: "anthropic",
      agent: null,
      spaceId: null,
    });
    expect(parseProxyRoute("/v1/chat/completions")).toEqual({
      protocol: "openai",
      agent: null,
      spaceId: null,
    });
    expect(parseProxyRoute("/nope")).toBeUndefined();
    expect(parseProxyRoute("/health")).toBeUndefined();
  });

  it("rejects bad access key → 401; health endpoint open", async () => {
    const app = createProxyApp({ coreBaseUrl: "http://127.0.0.1:0", accessKey: "secret-key" });
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const denied = await app.request("/claude-code/default/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentmemview-key": "wrong" },
      body: "{}",
    });
    expect(denied.status).toBe(401);

    const noKey = await app.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(noKey.status).toBe(401);

    // no access key configured → open access (local single-user default)
    const open = createProxyApp({
      coreBaseUrl: "http://127.0.0.1:0",
      upstreamBase: "http://127.0.0.1:1",
    });
    const allowed = await open.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", max_tokens: 100, messages: [] }),
    });
    expect(allowed.status).not.toBe(401);
  });

  it("checkAccessKey unit semantics", () => {
    expect(checkAccessKey(undefined, undefined)).toBe(true);
    expect(checkAccessKey("k", "k")).toBe(true);
    expect(checkAccessKey("k", "x")).toBe(false);
    expect(checkAccessKey("k", undefined)).toBe(false);
  });

  it("sidequery classification skips injection flag", () => {
    // heuristic v1 (documented in classify.ts): sidequery markers in
    // metadata.user_id or tiny max_tokens identify auxiliary calls
    expect(
      classifyRequestBody({ model: "m", metadata: { user_id: "sidequery-42" }, max_tokens: 4000 }),
    ).toBe("sidequery");
    expect(classifyRequestBody({ model: "m", max_tokens: 20 })).toBe("sidequery");
    expect(classifyRequestBody({ model: "m", max_tokens: 4000 })).toBe("main");
    expect(classifyRequestBody({ model: "m", max_tokens: 4000, forkOf: "req_1" })).toBe("fork");
  });
});
