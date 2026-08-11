/**
 * Typed API client for the core REST surface (openapi.yaml). Thin fetch
 * wrapper with ApiError status mapping; pages compose these calls.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiClientOptions {
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null | undefined;
}

export interface Fact {
  id: string;
  spaceId: string;
  agentId: string | null;
  content: string;
  status: "active" | "superseded" | "forgotten";
  pinned: boolean;
  confidence: number;
  halfLifeDays: number;
  accessCount: number;
  lastAccessedAt: string;
  sourceMessageId: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InjectionRow {
  id: string;
  sessionId: string | null;
  turn: number;
  blocks: Array<{ kind: string; tokens: number; content: string }>;
  tokens: Record<string, number>;
  cachePrefixMd5: string | null;
  createdAt: string;
}

export interface TraceStage {
  stage: string;
  candidates: string[];
}

export interface TraceRow {
  id: string;
  query: string;
  latencyMs: number;
  createdAt: string;
  stages?: TraceStage[] | undefined;
  results?: unknown[] | undefined;
}

export interface SearchResult {
  factId: string;
  content: string;
  score: number;
  decayFactor: number;
  entityBoost: boolean;
}

export interface SessionDiff {
  added: Fact[];
  updated: Fact[];
  forgotten: Fact[];
}

export class ApiClient {
  readonly #base: string;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.#base = (options.baseUrl ?? "").replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, init);
    const text = await res.text();
    if (!res.ok) {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      throw new ApiError(res.status, `${res.status} ${path}`, body);
    }
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  health(): Promise<{ ok: boolean }> {
    return this.request("/api/v1/health");
  }

  listServices(): Promise<Page<{ id: string; name: string }>> {
    return this.request("/api/v1/services");
  }

  listSpaces(serviceId?: string): Promise<Page<{ id: string; name: string; serviceId: string }>> {
    const query = serviceId !== undefined ? `?serviceId=${encodeURIComponent(serviceId)}` : "";
    return this.request(`/api/v1/spaces${query}`);
  }

  listAgents(spaceId?: string): Promise<Page<{ id: string; name: string; kind: string }>> {
    const query = spaceId !== undefined ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
    return this.request(`/api/v1/agents${query}`);
  }

  listMemories(spaceId: string, includeAllStatuses = false): Promise<{ items: Fact[] }> {
    const all = includeAllStatuses ? "&includeAllStatuses=1" : "";
    return this.request(`/api/v1/memories?spaceId=${encodeURIComponent(spaceId)}${all}`);
  }

  getMemoryLineage(id: string): Promise<{ chain: Fact[] }> {
    return this.request(`/api/v1/memories/${encodeURIComponent(id)}/lineage`);
  }

  updateMemory(id: string, content: string): Promise<Fact> {
    return this.request(`/api/v1/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  pinMemory(id: string, pinned: boolean): Promise<Fact> {
    return this.request(`/api/v1/memories/${encodeURIComponent(id)}/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
  }

  forgetByQuery(spaceId: string, query: string): Promise<{ forgotten: number }> {
    return this.request("/api/v1/memories/forget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, query }),
    });
  }

  search(spaceId: string, query: string): Promise<{ results: SearchResult[]; traceId: string }> {
    return this.request("/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, query }),
    });
  }

  listTraces(): Promise<{ items: TraceRow[] }> {
    return this.request("/api/v1/traces");
  }

  getTrace(id: string): Promise<TraceRow> {
    return this.request(`/api/v1/traces/${encodeURIComponent(id)}`);
  }

  listInjections(): Promise<{ items: InjectionRow[] }> {
    return this.request("/api/v1/injections");
  }

  listSessions(): Promise<{ items: Array<{ id: string; startedAt: string; agentId: string }> }> {
    return this.request("/api/v1/sessions");
  }

  sessionDiff(sessionId: string): Promise<SessionDiff> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/diff`);
  }

  getProfile(scope: string): Promise<{ contentMd: string | null; version?: number }> {
    return this.request(`/api/v1/profiles/${encodeURIComponent(scope)}`);
  }

  listScenarios(spaceId: string): Promise<{
    items: Array<{ id: string; title: string; summary: string; tokenEstimate: number }>;
  }> {
    return this.request(`/api/v1/scenarios?spaceId=${encodeURIComponent(spaceId)}`);
  }

  listSkills(spaceId: string): Promise<{
    items: Array<{ id: string; name: string; version: number; content: string }>;
  }> {
    return this.request(`/api/v1/skills?spaceId=${encodeURIComponent(spaceId)}`);
  }

  getCapabilities(): Promise<{ items: Array<Record<string, unknown>> }> {
    return this.request("/api/v1/capabilities");
  }

  getOnboardStatus(): Promise<{ items: Array<Record<string, unknown>> }> {
    return this.request("/api/v1/onboard/status");
  }

  getConfig(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/config");
  }

  putConfig(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/api/v1/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
  }
}

export const api = new ApiClient();
