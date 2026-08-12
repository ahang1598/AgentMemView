import type { InjectionSources } from "./injection/pipeline.js";
import type { InjectionRecord } from "./injection/prewarm.js";

/**
 * Thin REST client for the core service. All calls are best-effort where the
 * pipeline requires fail-open semantics (callers catch).
 */

export interface SpaceRef {
  id: string;
  serviceId: string;
  name: string;
}

interface Cached<T> {
  at: number;
  value: T;
}

const TTL_MS = 30_000;

export class CoreClient {
  readonly #base: string;
  readonly #profileCache = new Map<string, Cached<string | null>>();
  readonly #scenarioCache = new Map<string, Cached<Array<Record<string, unknown>>>>();
  readonly #skillsCache = new Map<string, Cached<Array<Record<string, unknown>>>>();

  constructor(coreBaseUrl: string) {
    this.#base = coreBaseUrl.replace(/\/$/, "");
  }

  get baseUrl(): string {
    return this.#base;
  }

  async resolveSpace(
    spaceIdOrName: string | null,
    defaultName: string,
  ): Promise<SpaceRef | undefined> {
    const res = await fetch(`${this.#base}/api/v1/spaces?limit=200`);
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    const body = (await res.json()) as {
      items?: Array<{ id: string; serviceId: string; name: string }>;
    };
    const items = body.items ?? [];
    const wanted = spaceIdOrName ?? defaultName;
    return (
      items.find((s) => s.id === wanted || s.name === wanted) ??
      items.find((s) => s.name === defaultName)
    );
  }

  async firstAgentId(spaceId: string): Promise<string | undefined> {
    const res = await fetch(
      `${this.#base}/api/v1/agents?spaceId=${encodeURIComponent(spaceId)}&limit=1`,
    );
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    const body = (await res.json()) as { items?: Array<{ id: string }> };
    return body.items?.[0]?.id;
  }

  /**
   * Return the space's first agent, creating one when the space is fresh.
   * Without this, session ensure silently falls back to a bare external id
   * and every L0 write-back fails the sessions FK constraint.
   */
  async ensureAgent(spaceId: string, kind: string, name: string): Promise<string | undefined> {
    const existing = await this.firstAgentId(spaceId).catch(() => undefined);
    if (existing !== undefined) {
      return existing;
    }
    try {
      const res = await fetch(`${this.#base}/api/v1/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, kind, name }),
      });
      if (!res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        return undefined;
      }
      const body = (await res.json()) as { id?: string };
      return body.id;
    } catch {
      return undefined;
    }
  }

  async ensureSession(agentId: string, externalId: string): Promise<string | undefined> {
    const res = await fetch(`${this.#base}/api/v1/sessions/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, externalId }),
    });
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    const body = (await res.json()) as { id?: string };
    return body.id;
  }

  async recordInjection(record: InjectionRecord): Promise<void> {
    const res = await fetch(`${this.#base}/api/v1/injections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: record.sessionId,
        turn: record.turn,
        blocks: record.blocks,
        tokens: record.tokenJson,
        cachePrefixMd5: record.cachePrefixMd5,
      }),
    });
    await res.arrayBuffer().catch(() => undefined);
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await fetch(`${this.#base}${path}`);
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    return res.json();
  }

  private cached<T>(cache: Map<string, Cached<T>>, key: string): T | undefined {
    const hit = cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < TTL_MS) {
      return hit.value;
    }
    return undefined;
  }

  /** InjectionSources backed by core REST with 30s TTL caches. */
  sources(spaceId: string): InjectionSources {
    return {
      getProfile: async () => {
        const hit = this.cached(this.#profileCache, spaceId);
        if (hit !== undefined) {
          return hit;
        }
        try {
          const body = (await this.getJson(
            `/api/v1/profiles/${encodeURIComponent(`space:${spaceId}`)}`,
          )) as { contentMd?: string } | undefined;
          const value = body?.contentMd ?? null;
          this.#profileCache.set(spaceId, { at: Date.now(), value });
          return value;
        } catch {
          return null;
        }
      },
      getScenarioIndex: async () => {
        const hit = this.cached(this.#scenarioCache, spaceId);
        if (hit !== undefined) {
          return mapScenarios(hit);
        }
        try {
          const body = (await this.getJson(
            `/api/v1/scenarios?spaceId=${encodeURIComponent(spaceId)}`,
          )) as { items?: Array<Record<string, unknown>> } | undefined;
          const items = body?.items ?? [];
          this.#scenarioCache.set(spaceId, { at: Date.now(), value: items });
          return mapScenarios(items);
        } catch {
          return [];
        }
      },
      getSkillsList: async () => {
        const hit = this.cached(this.#skillsCache, spaceId);
        if (hit !== undefined) {
          return mapSkills(hit);
        }
        try {
          const body = (await this.getJson(
            `/api/v1/skills?spaceId=${encodeURIComponent(spaceId)}`,
          )) as { items?: Array<Record<string, unknown>> } | undefined;
          const items = body?.items ?? [];
          this.#skillsCache.set(spaceId, { at: Date.now(), value: items });
          return mapSkills(items);
        } catch {
          return [];
        }
      },
    };
  }
}

function mapScenarios(items: Array<Record<string, unknown>>): Array<{
  id: string;
  title: string;
  summary: string;
  tokenEstimate: number;
}> {
  return items.map((item) => ({
    id: String(item.id ?? ""),
    title: String(item.title ?? ""),
    summary: String(item.summary ?? ""),
    tokenEstimate: Number(item.tokenEstimate ?? 0),
  }));
}

function mapSkills(
  items: Array<Record<string, unknown>>,
): Array<{ name: string; oneLiner: string }> {
  return items.map((item) => ({
    name: String(item.name ?? ""),
    oneLiner: String(item.summary ?? item.content ?? "").slice(0, 120),
  }));
}
