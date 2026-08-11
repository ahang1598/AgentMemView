import {
  type AgentContext,
  deepClone,
  emptyInjections,
  hasInjections,
  type ProtocolAdapter,
  type SystemBlockView,
} from "./types.js";

/**
 * OpenAI Chat Completions adapter. System content lives in a role=system
 * message; injection appends text to it (or creates one). tool_calls and
 * function payloads pass through untouched.
 */

interface ChatMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

function findSystemIndex(messages: ChatMessage[]): number {
  return messages.findIndex((m) => m.role === "system");
}

function systemTextOf(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return "";
}

export const openaiAdapter: ProtocolAdapter = {
  protocol: "openai",

  parse(rawBody: unknown): AgentContext {
    const raw = deepClone((rawBody ?? {}) as Record<string, unknown>);
    const messages = Array.isArray(raw.messages) ? (raw.messages as ChatMessage[]) : [];
    const systemIndex = findSystemIndex(messages);
    const systemBlocks: SystemBlockView[] =
      systemIndex >= 0 && messages[systemIndex] !== undefined
        ? [{ text: systemTextOf(messages[systemIndex] as ChatMessage), hasCacheControl: false }]
        : [];
    const tools = Array.isArray(raw.tools) ? (raw.tools as Array<Record<string, unknown>>) : [];
    return {
      protocol: "openai",
      model: typeof raw.model === "string" ? raw.model : "",
      stream: raw.stream === true,
      systemBlocks,
      tools: deepClone(tools),
      raw,
      injections: emptyInjections(),
    };
  },

  serialize(ctx: AgentContext): Record<string, unknown> {
    const out = deepClone(ctx.raw);
    if (!hasInjections(ctx)) {
      return out;
    }
    const { systemPrefix, systemSuffix, toolsAppend } = ctx.injections;
    if (systemPrefix.length > 0 || systemSuffix.length > 0) {
      const messages = Array.isArray(out.messages) ? (out.messages as ChatMessage[]) : [];
      const injectedText = [...systemPrefix, ...systemSuffix];
      const systemIndex = findSystemIndex(messages);
      if (systemIndex >= 0 && messages[systemIndex] !== undefined) {
        const existing = systemTextOf(messages[systemIndex] as ChatMessage);
        const parts = [
          ...systemPrefix,
          ...(existing.length > 0 ? [existing] : []),
          ...systemSuffix,
        ];
        (messages[systemIndex] as ChatMessage).content = parts.join("\n\n");
      } else {
        messages.unshift({ role: "system", content: injectedText.join("\n\n") });
      }
      out.messages = messages;
    }
    if (toolsAppend.length > 0) {
      const existing = Array.isArray(out.tools) ? (out.tools as unknown[]) : [];
      out.tools = [...existing, ...deepClone(toolsAppend)];
    }
    return out;
  },
};
