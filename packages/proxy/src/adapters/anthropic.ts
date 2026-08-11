import {
  type AgentContext,
  deepClone,
  emptyInjections,
  hasInjections,
  type ProtocolAdapter,
  type SystemBlockView,
  textBlock,
} from "./types.js";

/**
 * Anthropic Messages API adapter. Round-trip discipline: with empty
 * injection slots serialize(parse(x)) deep-equals x — tool_use/tool_result/
 * cache_control/thinking blocks pass through byte-for-byte.
 */

function extractSystemBlocks(raw: Record<string, unknown>): SystemBlockView[] {
  const system = raw.system;
  if (typeof system === "string") {
    return [{ text: system, hasCacheControl: false }];
  }
  if (Array.isArray(system)) {
    return system
      .filter(
        (block): block is Record<string, unknown> => block !== null && typeof block === "object",
      )
      .map((block) => ({
        text: typeof block.text === "string" ? block.text : "",
        hasCacheControl: block.cache_control !== undefined,
      }));
  }
  return [];
}

export const anthropicAdapter: ProtocolAdapter = {
  protocol: "anthropic",

  parse(rawBody: unknown): AgentContext {
    const raw = deepClone((rawBody ?? {}) as Record<string, unknown>);
    const tools = Array.isArray(raw.tools) ? (raw.tools as Array<Record<string, unknown>>) : [];
    return {
      protocol: "anthropic",
      model: typeof raw.model === "string" ? raw.model : "",
      stream: raw.stream === true,
      systemBlocks: extractSystemBlocks(raw),
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
      const prefixBlocks = systemPrefix.map(textBlock);
      const suffixBlocks = systemSuffix.map(textBlock);
      const native = out.system;
      let nativeBlocks: Array<Record<string, unknown>>;
      if (typeof native === "string") {
        nativeBlocks = [textBlock(native)];
      } else if (Array.isArray(native)) {
        nativeBlocks = native as Array<Record<string, unknown>>;
      } else {
        nativeBlocks = [];
      }
      out.system = [...prefixBlocks, ...nativeBlocks, ...suffixBlocks];
    }
    if (toolsAppend.length > 0) {
      const existing = Array.isArray(out.tools) ? (out.tools as unknown[]) : [];
      out.tools = [...existing, ...deepClone(toolsAppend)];
    }
    return out;
  },
};
