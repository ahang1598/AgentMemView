/**
 * mem: session commands (Spec section 7). Executed locally by the proxy —
 * zero upstream tokens. Responses are synthesized in both protocol shapes.
 */

import type { Protocol } from "../routing.js";

export interface MemCommandContext {
  coreBaseUrl: string;
  spaceId: string;
  protocol: Protocol;
  model: string;
}

export interface MemCommandResult {
  handled: boolean;
  text?: string | undefined;
  response?: Record<string, unknown> | undefined;
}

export interface ParsedMemCommand {
  command: string;
  arg: string;
}

const HELP_TEXT = [
  "Available memory commands:",
  "- mem:remember <fact>  store an explicit fact into long-term memory",
  "- mem:forget <query>   mark matching facts as forgotten (recoverable)",
  "- mem:status           show the current injection summary",
  "- mem:sync             trigger background refinement (requires LLM gateway)",
].join("\n");

export function parseMemCommand(text: string): ParsedMemCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("mem:")) {
    return undefined;
  }
  const rest = trimmed.slice("mem:".length);
  const spaceIndex = rest.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: rest.trim(), arg: "" };
  }
  return { command: rest.slice(0, spaceIndex).trim(), arg: rest.slice(spaceIndex + 1).trim() };
}

export async function handleMemCommand(
  ctx: MemCommandContext,
  text: string,
): Promise<MemCommandResult> {
  const parsed = parseMemCommand(text);
  if (parsed === undefined) {
    return { handled: false };
  }
  const coreBase = ctx.coreBaseUrl.replace(/\/$/, "");
  let resultText: string;
  switch (parsed.command) {
    case "remember": {
      if (parsed.arg.length === 0) {
        resultText = "usage: mem:remember <fact>";
        break;
      }
      const res = await fetch(`${coreBase}/api/v1/memories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: ctx.spaceId, content: parsed.arg }),
      });
      resultText = res.ok
        ? `remembered: ${parsed.arg}`
        : `failed to store memory (core responded ${res.status})`;
      await res.arrayBuffer().catch(() => undefined);
      break;
    }
    case "forget": {
      if (parsed.arg.length === 0) {
        resultText = "usage: mem:forget <query>";
        break;
      }
      const res = await fetch(`${coreBase}/api/v1/memories/forget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: ctx.spaceId, query: parsed.arg }),
      });
      if (res.ok) {
        const body = (await res.json()) as { forgotten?: number };
        resultText = `forgotten ${body.forgotten ?? 0} memories matching "${parsed.arg}" (recoverable in Dashboard)`;
      } else {
        resultText = `failed to forget memories (core responded ${res.status})`;
        await res.arrayBuffer().catch(() => undefined);
      }
      break;
    }
    case "status": {
      const res = await fetch(`${coreBase}/api/v1/injections`);
      if (res.ok) {
        const body = (await res.json()) as {
          items?: Array<{ cachePrefixMd5?: string | null; turn?: number }>;
        };
        const latest = body.items?.[0];
        resultText =
          latest === undefined
            ? "no injections recorded yet"
            : `last injection: turn ${latest.turn ?? 0}, prefix md5 ${latest.cachePrefixMd5 ?? "-"}`;
      } else {
        resultText = `failed to read injections (core responded ${res.status})`;
        await res.arrayBuffer().catch(() => undefined);
      }
      break;
    }
    case "sync": {
      resultText =
        "refinement runs in the background when the LLM gateway capability is enabled; nothing to sync offline";
      break;
    }
    default: {
      resultText = HELP_TEXT;
    }
  }
  return { handled: true, text: resultText, response: synthesize(ctx, resultText) };
}

function synthesize(ctx: MemCommandContext, text: string): Record<string, unknown> {
  if (ctx.protocol === "anthropic") {
    return {
      id: `agentmemview_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: ctx.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: Math.ceil(text.length / 4) },
    };
  }
  return {
    id: `agentmemview_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: ctx.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: Math.ceil(text.length / 4),
      total_tokens: Math.ceil(text.length / 4),
    },
  };
}
