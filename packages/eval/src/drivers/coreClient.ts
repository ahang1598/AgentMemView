/**
 * Ingest/retrieve drivers against the core REST API. Eval runs live in an
 * isolated space (service=eval, space=<dataset>-<runId>) so user data is
 * never polluted.
 */

export interface EvalCoreClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch | undefined;
}

export class EvalCoreClient {
  readonly #base: string;
  readonly #fetch: typeof fetch;

  constructor(options: EvalCoreClientOptions) {
    this.#base = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`core ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  /** Create (or reuse) the isolated eval tenancy; returns the space id. */
  async ensureEvalSpace(dataset: string, runId: string): Promise<{ spaceId: string }> {
    const services = await this.#json<{ items: Array<{ id: string; name: string }> }>(
      "/api/v1/services",
    );
    let service = services.items.find((s) => s.name === "eval");
    if (service === undefined) {
      service = await this.#json<{ id: string; name: string }>("/api/v1/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "eval" }),
      });
    }
    const spaceName = `${dataset}-${runId}`;
    const spaces = await this.#json<{ items: Array<{ id: string; name: string }> }>(
      `/api/v1/spaces?serviceId=${encodeURIComponent(service.id)}`,
    );
    let space = spaces.items.find((s) => s.name === spaceName);
    if (space === undefined) {
      space = await this.#json<{ id: string; name: string }>("/api/v1/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, name: spaceName }),
      });
    }
    return { spaceId: space.id };
  }

  /** Ingest texts as L1 facts (batched, small delay between batches). */
  async ingestFacts(spaceId: string, texts: string[], batchDelayMs = 5): Promise<string[]> {
    const ids: string[] = [];
    const BATCH = 25;
    for (let start = 0; start < texts.length; start += BATCH) {
      const batch = texts.slice(start, start + BATCH);
      for (const content of batch) {
        const created = await this.#json<{ id: string }>("/api/v1/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, content }),
        });
        ids.push(created.id);
      }
      if (start + BATCH < texts.length && batchDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, batchDelayMs);
        });
      }
    }
    return ids;
  }

  /** Run one retrieval; returns ranked fact ids + trace id. */
  async retrieve(
    spaceId: string,
    query: string,
    topK = 10,
  ): Promise<{ factIds: string[]; traceId: string }> {
    const body = await this.#json<{
      results: Array<{ factId: string }>;
      traceId: string;
    }>("/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, query, topK }),
    });
    return { factIds: body.results.map((r) => r.factId), traceId: body.traceId };
  }
}
