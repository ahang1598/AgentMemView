/**
 * Proxy route parsing (Spec section 7 route table).
 * URL convention learned from MemoryProxy: /{agent}/{spaceId}/v1/... plus
 * bare /v1/... forms that resolve to the default space.
 */

export type Protocol = "anthropic" | "openai";

export interface ProxyRoute {
  protocol: Protocol;
  /** null for bare paths (default space). */
  agent: string | null;
  spaceId: string | null;
}

export function parseProxyRoute(path: string): ProxyRoute | undefined {
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length === 2 && segments[0] === "v1" && segments[1] === "messages") {
    return { protocol: "anthropic", agent: null, spaceId: null };
  }
  if (segments.length === 3 && segments[0] === "v1" && segments[1] === "chat") {
    if (segments[2] === "completions") {
      return { protocol: "openai", agent: null, spaceId: null };
    }
    return undefined;
  }
  if (segments.length === 4 && segments[2] === "v1" && segments[3] === "messages") {
    return { protocol: "anthropic", agent: segments[0] ?? null, spaceId: segments[1] ?? null };
  }
  if (
    segments.length === 5 &&
    segments[2] === "v1" &&
    segments[3] === "chat" &&
    segments[4] === "completions"
  ) {
    return { protocol: "openai", agent: segments[0] ?? null, spaceId: segments[1] ?? null };
  }
  return undefined;
}
