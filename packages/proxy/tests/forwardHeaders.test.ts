import { describe, expect, it } from "vitest";
import { filterForwardHeaders } from "../src/upstream/forward.js";

describe("filterForwardHeaders", () => {
  it("keeps upstream credentials and protocol headers", () => {
    const out = filterForwardHeaders({
      "x-api-key": "secret",
      Authorization: "Bearer x",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(out["x-api-key"]).toBe("secret");
    expect(out.Authorization).toBe("Bearer x");
    expect(out["anthropic-version"]).toBe("2023-06-01");
  });

  it("strips hop-by-hop and undici-incompatible headers (Expect regression)", () => {
    // PowerShell's Invoke-WebRequest sends "Expect: 100-continue" which undici
    // rejects with UND_ERR_NOT_SUPPORTED; real clients may also send te/expect
    const out = filterForwardHeaders({
      Host: "127.0.0.1:8619",
      "Content-Length": "10",
      Connection: "Keep-Alive",
      Expect: "100-continue",
      TE: "trailers",
      "x-agentmemview-key": "local",
      "x-api-key": "keep-me",
    });
    expect(out).toEqual({ "x-api-key": "keep-me" });
  });
});
