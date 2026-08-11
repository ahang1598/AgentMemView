import { Hono } from "hono";
import { ACCESS_KEY_HEADER, checkAccessKey } from "./auth.js";
import { CoreClient } from "./coreClient.js";
import { ProxyPipeline } from "./pipeline.js";
import { SlidingWindowLimiter } from "./ratelimit/guard.js";
import { parseProxyRoute } from "./routing.js";
import { L0Client } from "./writeback/l0Client.js";

/**
 * Transparent proxy app (Spec section 7). Edge concerns (routing, auth,
 * body parsing) live here; the 8-stage pipeline lives in ProxyPipeline.
 */

export interface ProxyOptions {
  /** Core REST base URL, e.g. http://127.0.0.1:8620 */
  coreBaseUrl: string;
  /** Local access key; open access when unset. */
  accessKey?: string | undefined;
  /** Single upstream override (tests/gateways); otherwise env defaults. */
  upstreamBase?: string | undefined;
  /** Space name used by bare /v1/* paths. */
  defaultSpaceName?: string | undefined;
  /** Requests per minute per space:model; default 600. */
  qpm?: number | undefined;
}

const DEFAULT_ANTHROPIC_UPSTREAM = "https://api.anthropic.com";
const DEFAULT_OPENAI_UPSTREAM = "https://api.openai.com";

export function createProxyApp(options: ProxyOptions): Hono {
  const app = new Hono();
  const defaultSpaceName = options.defaultSpaceName ?? "default";
  const core = new CoreClient(options.coreBaseUrl);
  const pipeline = new ProxyPipeline({
    core,
    l0: new L0Client({ coreBaseUrl: options.coreBaseUrl }),
    limiter: new SlidingWindowLimiter({ qpm: options.qpm ?? 600 }),
    upstreamBase:
      options.upstreamBase ?? process.env.AGENTMEMVIEW_UPSTREAM_BASE ?? DEFAULT_ANTHROPIC_UPSTREAM,
    defaultSpaceName,
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.all("*", async (c) => {
    const route = parseProxyRoute(c.req.path);
    if (route === undefined) {
      return c.json({ error: "not_found", message: `no proxy route for ${c.req.path}` }, 404);
    }
    const provided = c.req.header(ACCESS_KEY_HEADER);
    if (!checkAccessKey(options.accessKey, provided)) {
      return c.json({ error: "unauthorized", message: "invalid access key" }, 401);
    }
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "validation", message: "request body must be JSON" }, 400);
    }
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    try {
      return await pipeline.process({ route, body, headers });
    } catch (err) {
      return c.json(
        { error: "bad_gateway", message: `proxy pipeline failed: ${(err as Error).message}` },
        502,
      );
    }
  });

  return app;
}

export { DEFAULT_ANTHROPIC_UPSTREAM, DEFAULT_OPENAI_UPSTREAM };
