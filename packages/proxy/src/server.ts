import { serve } from "@hono/node-server";
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
  /** Single upstream override for BOTH protocols (tests/gateways). */
  upstreamBase?: string | undefined;
  /** Anthropic-protocol upstream (real LLM gateway). */
  upstreamAnthropic?: string | undefined;
  /** OpenAI-protocol upstream (real LLM gateway). */
  upstreamOpenai?: string | undefined;
  /** Space name used by bare /v1/* paths. */
  defaultSpaceName?: string | undefined;
  /** Requests per minute per space:model; default 600. */
  qpm?: number | undefined;
}

const DEFAULT_ANTHROPIC_UPSTREAM = "https://api.anthropic.com";
const DEFAULT_OPENAI_UPSTREAM = "https://api.openai.com";

/**
 * Resolve the real LLM upstream per protocol. Priority:
 * explicit option > dedicated env > the agent's own env var (when it does
 * not point back at this proxy, which would loop) > hard default.
 * API keys are NOT managed here: the client (e.g. Claude Code) keeps sending
 * x-api-key / Authorization and the proxy forwards them untouched.
 */
export function resolveUpstreams(
  options: ProxyOptions,
  env: Record<string, string | undefined> = process.env,
  proxyPort = 8619,
): { anthropic: string; openai: string } {
  const isSelf = (url: string | undefined): boolean =>
    url !== undefined &&
    new URL(url).port === String(proxyPort) &&
    /127\.0\.0\.1|localhost/.test(new URL(url).hostname);
  if (options.upstreamBase !== undefined) {
    return { anthropic: options.upstreamBase, openai: options.upstreamBase };
  }
  const anthropic =
    options.upstreamAnthropic ??
    env.AGENTMEMVIEW_UPSTREAM_ANTHROPIC ??
    env.AGENTMEMVIEW_UPSTREAM_BASE ??
    (!isSelf(env.ANTHROPIC_BASE_URL) ? env.ANTHROPIC_BASE_URL : undefined) ??
    DEFAULT_ANTHROPIC_UPSTREAM;
  const openai =
    options.upstreamOpenai ??
    env.AGENTMEMVIEW_UPSTREAM_OPENAI ??
    env.AGENTMEMVIEW_UPSTREAM_BASE ??
    (!isSelf(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : undefined) ??
    DEFAULT_OPENAI_UPSTREAM;
  return { anthropic, openai };
}

export function createProxyApp(options: ProxyOptions): Hono {
  const app = new Hono();
  const defaultSpaceName = options.defaultSpaceName ?? "default";
  const core = new CoreClient(options.coreBaseUrl);
  const pipeline = new ProxyPipeline({
    core,
    l0: new L0Client({ coreBaseUrl: options.coreBaseUrl }),
    limiter: new SlidingWindowLimiter({ qpm: options.qpm ?? 600 }),
    upstreams: resolveUpstreams(options),
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
      const error = err as Error & { cause?: { message?: string; code?: string } };
      const detail = [error.message, error.cause?.message, error.cause?.code]
        .filter((part) => part !== undefined && part !== "")
        .join(" | ");
      console.error(`[proxy] pipeline failed: ${detail}`);
      return c.json({ error: "bad_gateway", message: `proxy pipeline failed: ${detail}` }, 502);
    }
  });

  return app;
}

export interface ProxyServerOptions extends ProxyOptions {
  port: number;
  host: string;
}

export interface RunningProxy {
  port: number;
  upstreams: { anthropic: string; openai: string };
  close: () => Promise<void>;
}

/** Bind the proxy app to a port (used by `agentmemview proxy start`). */
export async function startProxyServer(options: ProxyServerOptions): Promise<RunningProxy> {
  const app = createProxyApp(options);
  const server = serve({ fetch: app.fetch, port: options.port, hostname: options.host });
  // port 0 picks an ephemeral port; report the actually bound one
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;
  return {
    port: boundPort,
    upstreams: resolveUpstreams(options),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err !== undefined) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}

export { DEFAULT_ANTHROPIC_UPSTREAM, DEFAULT_OPENAI_UPSTREAM };
