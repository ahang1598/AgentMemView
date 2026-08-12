import { randomUUID } from "node:crypto";
import { anthropicAdapter } from "./adapters/anthropic.js";
import { openaiAdapter } from "./adapters/openai.js";
import type { AgentContext } from "./adapters/types.js";
import { classifyRequestBody } from "./classify.js";
import { handleMemCommand } from "./commands/memCommands.js";
import type { CoreClient } from "./coreClient.js";
import { InjectionPipeline } from "./injection/pipeline.js";
import type { SlidingWindowLimiter } from "./ratelimit/guard.js";
import { countUserTurns, respondJson, respondStream } from "./respond.js";
import type { ProxyRoute } from "./routing.js";
import { forwardRequest } from "./upstream/forward.js";
import type { L0Client } from "./writeback/l0Client.js";

/**
 * The request pipeline (Spec section 7): classify → session init → inject →
 * ratelimit → forward → tee → write-back. Auth happens at the server edge.
 */

export interface PipelineDeps {
  core: CoreClient;
  l0: L0Client;
  limiter: SlidingWindowLimiter;
  /** Per-protocol upstream bases (real LLM gateways). */
  upstreams: { anthropic: string; openai: string };
  defaultSpaceName: string;
}

export interface PipelineInput {
  route: ProxyRoute;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function lastUserText(body: Record<string, unknown>): string {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown } | undefined;
    if (message?.role !== "user") {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter(
          (b): b is { type: string; text: string } =>
            b !== null && typeof b === "object" && (b as { type?: unknown }).type === "text",
        )
        .map((b) => b.text)
        .join("\n");
    }
  }
  return "";
}

function upstreamUrl(deps: PipelineDeps, route: ProxyRoute): string {
  const base = (
    route.protocol === "anthropic" ? deps.upstreams.anthropic : deps.upstreams.openai
  ).replace(/\/$/, "");
  return route.protocol === "anthropic" ? `${base}/v1/messages` : `${base}/v1/chat/completions`;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export class ProxyPipeline {
  readonly #pipelines = new Map<string, InjectionPipeline>();

  constructor(private readonly deps: PipelineDeps) {}

  async process(input: PipelineInput): Promise<Response> {
    const { route, body, headers } = input;
    const adapter = route.protocol === "anthropic" ? anthropicAdapter : openaiAdapter;
    const ctx: AgentContext = adapter.parse(body);
    const externalId = this.extractExternalId(body);

    // mem: commands short-circuit locally (zero upstream tokens)
    const userText = lastUserText(body);
    if (userText.trimStart().startsWith("mem:")) {
      const memResponse = await this.runMemCommand(route, ctx.model, userText);
      if (memResponse !== undefined) {
        return memResponse;
      }
    }

    const requestClass = classifyRequestBody(body);
    const space = await this.deps.core
      .resolveSpace(route.spaceId, this.deps.defaultSpaceName)
      .catch(() => undefined);
    let sessionId = externalId;
    if (space !== undefined) {
      const agentId = await this.deps.core.firstAgentId(space.id).catch(() => undefined);
      if (agentId !== undefined) {
        sessionId =
          (await this.deps.core.ensureSession(agentId, externalId).catch(() => undefined)) ??
          externalId;
      }
    }

    // injection stage (sidequery/fork skip entirely)
    if (requestClass === "main" && space !== undefined) {
      await this.inject(ctx, space.id, sessionId, countUserTurns(body));
    }

    // ratelimit stage (fail-open inside the limiter)
    const limit = this.deps.limiter.tryAcquire(`${space?.id ?? "default"}:${ctx.model}`);
    if (!limit.allowed) {
      return jsonResponse({ error: "rate_limited", message: "too many requests, slow down" }, 429, {
        "retry-after": String(limit.retryAfterSec ?? 1),
      });
    }

    // serialize with injections; openai streaming forces include_usage
    let outBody = adapter.serialize(ctx);
    if (route.protocol === "openai" && outBody.stream === true) {
      outBody = { ...outBody, stream_options: { include_usage: true } };
    }

    const upstream = await forwardRequest({
      url: upstreamUrl(this.deps, route),
      method: "POST",
      body: JSON.stringify(outBody),
      headers,
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return respondStream(route, upstream, sessionId, body, this.deps.l0);
    }
    return respondJson(route, upstream, sessionId, body, this.deps.l0);
  }

  private async runMemCommand(
    route: ProxyRoute,
    model: string,
    userText: string,
  ): Promise<Response | undefined> {
    const space = await this.deps.core
      .resolveSpace(route.spaceId, this.deps.defaultSpaceName)
      .catch(() => undefined);
    const result = await handleMemCommand(
      {
        coreBaseUrl: this.deps.core.baseUrl,
        spaceId: space?.id ?? this.deps.defaultSpaceName,
        protocol: route.protocol,
        model,
      },
      userText,
    );
    if (result.handled && result.response !== undefined) {
      return jsonResponse(result.response);
    }
    return undefined;
  }

  private async inject(
    ctx: AgentContext,
    spaceId: string,
    sessionId: string,
    turn: number,
  ): Promise<void> {
    let pipeline = this.#pipelines.get(spaceId);
    if (pipeline === undefined) {
      pipeline = new InjectionPipeline({ sources: this.deps.core.sources(spaceId) });
      this.#pipelines.set(spaceId, pipeline);
    }
    const result = await pipeline.run(ctx, { sessionId, spaceId, turn });
    if (result.blocks.length > 0) {
      await this.deps.core
        .recordInjection({
          sessionId,
          turn,
          blocks: result.blocks,
          tokenJson: { total: result.totalTokens },
          cachePrefixMd5: result.cachePrefixMd5,
          createdAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
  }

  private extractExternalId(body: Record<string, unknown>): string {
    const metadata = body.metadata;
    if (metadata !== null && typeof metadata === "object") {
      const record = metadata as Record<string, unknown>;
      if (typeof record.session_id === "string" && record.session_id.length > 0) {
        return record.session_id;
      }
      if (typeof record.user_id === "string" && record.user_id.length > 0) {
        return `user:${record.user_id}`;
      }
    }
    return `anon:${randomUUID()}`;
  }
}
