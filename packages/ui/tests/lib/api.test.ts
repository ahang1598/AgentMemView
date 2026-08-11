import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../../src/lib/api.js";

describe("api client (M3-02)", () => {
  it("maps successful JSON responses", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = new ApiClient({ baseUrl: "http://core", fetchImpl });
    await expect(client.health()).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("http://core/api/v1/health", undefined);
  });

  it("404 throws ApiError with status", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const client = new ApiClient({ fetchImpl });
    try {
      await client.request("/api/v1/traces/nope");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    }
  });

  it("search posts scoped query", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ results: [], traceId: "t-1" }), { status: 200 }),
    );
    const client = new ApiClient({ fetchImpl });
    const out = await client.search("space-1", "包管理器");
    expect(out.traceId).toBe("t-1");
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("space-1");
  });
});
