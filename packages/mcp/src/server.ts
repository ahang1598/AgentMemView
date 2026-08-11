/**
 * Minimal MCP JSON-RPC server (Model Context Protocol). Implemented natively
 * (no SDK dependency): initialize / tools/list / tools/call. Transport is
 * pluggable — stdio (bin) and single-POST HTTP.
 */

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export class McpServer {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(private readonly info: McpServerInfo) {}

  register(tool: ToolDefinition): void {
    this.#tools.set(tool.name, tool);
  }

  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return [...this.#tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      return {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `tool failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    const id = request.id ?? null;
    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: this.info,
          },
        };
      case "notifications/initialized":
        return undefined; // notification: no response
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: this.listTools() } };
      case "tools/call": {
        const params = request.params ?? {};
        const name = typeof params.name === "string" ? params.name : "";
        const args =
          params.arguments !== null && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        return { jsonrpc: "2.0", id, result: await this.callTool(name, args) };
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${request.method}` },
        };
    }
  }
}
