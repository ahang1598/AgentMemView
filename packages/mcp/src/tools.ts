import { McpServer, type ToolDefinition } from "./server.js";

/**
 * The locked 8 MCP tools (Spec section 8). All state lives in core; every
 * tool is a thin validated call against the core REST API.
 */

export interface MemoryToolsOptions {
  coreBaseUrl: string;
  /** Default space (name or id) when a tool call omits it. */
  defaultSpace?: string | undefined;
}

interface CoreSpace {
  id: string;
  name: string;
}

async function coreFetch(base: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`core ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return text.length > 0 ? JSON.parse(text) : undefined;
}

async function resolveSpaceId(
  base: string,
  space: string | undefined,
  fallback: string,
): Promise<string> {
  const wanted = space ?? fallback;
  const body = (await coreFetch(base, "/api/v1/spaces?limit=200")) as {
    items?: CoreSpace[];
  };
  const items = body.items ?? [];
  const hit = items.find((s) => s.id === wanted || s.name === wanted);
  if (hit === undefined) {
    throw new Error(`space not found: ${wanted}`);
  }
  return hit.id;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createMemoryTools(options: MemoryToolsOptions): ToolDefinition[] {
  const base = options.coreBaseUrl.replace(/\/$/, "");
  const fallback = options.defaultSpace ?? "default";

  return [
    {
      name: "memory_search",
      description: "Hybrid search over long-term memory (full pipeline, writes a trace).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          space: { type: "string" },
          topK: { type: "number" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const spaceId = await resolveSpaceId(base, str(args, "space"), fallback);
        const topK = typeof args.topK === "number" ? args.topK : undefined;
        return coreFetch(base, "/api/v1/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: str(args, "query") ?? "",
            spaceId,
            ...(topK !== undefined ? { topK } : {}),
          }),
        });
      },
    },
    {
      name: "memory_read",
      description: "Read one memory by id, including its supersede lineage.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      handler: async (args) => {
        const id = str(args, "id") ?? "";
        const [fact, lineage] = await Promise.all([
          coreFetch(base, `/api/v1/memories/${encodeURIComponent(id)}`),
          coreFetch(base, `/api/v1/memories/${encodeURIComponent(id)}/lineage`),
        ]);
        return { fact, lineage };
      },
    },
    {
      name: "memory_write",
      description: "Explicitly store a fact into L1 memory.",
      inputSchema: {
        type: "object",
        properties: { content: { type: "string" }, space: { type: "string" } },
        required: ["content"],
      },
      handler: async (args) => {
        const spaceId = await resolveSpaceId(base, str(args, "space"), fallback);
        return coreFetch(base, "/api/v1/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, content: str(args, "content") ?? "" }),
        });
      },
    },
    {
      name: "memory_pin",
      description: "Pin (exempt from decay) or unpin a memory.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, pinned: { type: "boolean" } },
        required: ["id"],
      },
      handler: async (args) =>
        coreFetch(base, `/api/v1/memories/${encodeURIComponent(str(args, "id") ?? "")}/pin`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinned: args.pinned !== false }),
        }),
    },
    {
      name: "memory_forget",
      description: "Mark memories matching a query as forgotten (recoverable).",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, space: { type: "string" } },
        required: ["query"],
      },
      handler: async (args) => {
        const spaceId = await resolveSpaceId(base, str(args, "space"), fallback);
        return coreFetch(base, "/api/v1/memories/forget", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, query: str(args, "query") ?? "" }),
        });
      },
    },
    {
      name: "memory_traces",
      description: "List recent retrieval traces (pipeline decision replay).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => coreFetch(base, "/api/v1/traces"),
    },
    {
      name: "profile_read",
      description: "Read the L3 profile for a scope (service:<id> or space:<id>).",
      inputSchema: {
        type: "object",
        properties: { scope: { type: "string" } },
        required: ["scope"],
      },
      handler: async (args) =>
        coreFetch(base, `/api/v1/profiles/${encodeURIComponent(str(args, "scope") ?? "")}`),
    },
    {
      name: "skills_list",
      description: "List skill assets of a space.",
      inputSchema: {
        type: "object",
        properties: { space: { type: "string" } },
      },
      handler: async (args) => {
        const spaceId = await resolveSpaceId(base, str(args, "space"), fallback);
        return coreFetch(base, `/api/v1/skills?spaceId=${encodeURIComponent(spaceId)}`);
      },
    },
  ];
}

export function createAgentMemViewMcp(options: MemoryToolsOptions): McpServer {
  const server = new McpServer({ name: "agentmemview-mcp", version: "0.1.0" });
  for (const tool of createMemoryTools(options)) {
    server.register(tool);
  }
  return server;
}
