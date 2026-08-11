/**
 * Upstream forwarder (Spec section 7 stage 6).
 * Header policy learned from MemoryProxy:
 * - strip our internal headers (x-agentmemview-*) and hop-by-hop headers;
 * - drop host/content-length: fetch sets them for the upstream target;
 * - KEEP the user's upstream credentials (x-api-key / authorization) — the
 *   proxy is transparent for auth; local access key auth happens at our edge.
 * Retry policy: one retry on 429/5xx (retryTarget), never on 4xx client errors.
 */

export interface ForwardOptions {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number | undefined;
  /** Default [429, 500, 502, 503]. */
  retryStatuses?: number[] | undefined;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_STATUSES = [429, 500, 502, 503];

const STRIPPED_PREFIXES = ["x-agentmemview-"];
const STRIPPED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export function filterForwardHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (STRIPPED_HEADERS.has(lower)) {
      continue;
    }
    if (STRIPPED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function forwardRequest(options: ForwardOptions): Promise<Response> {
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = filterForwardHeaders(options.headers);

  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(options.url, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
        // upstream may be self-signed local gateway; local product keeps default
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`upstream timeout after ${timeoutMs}ms: ${options.url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt();
  if (retryStatuses.includes(first.status)) {
    // drain the failed response body before retrying
    await first.arrayBuffer().catch(() => undefined);
    return attempt();
  }
  return first;
}
