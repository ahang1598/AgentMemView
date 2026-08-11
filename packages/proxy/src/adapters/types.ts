import type { Protocol } from "../routing.js";

/**
 * AgentContext IR (Spec section 7 adapter layer): parse(body) → AgentContext
 * → 9 injection-point hooks → serialize(). Native blocks stay untouched;
 * only the injection slots may change the serialized output.
 */

export interface SystemBlockView {
  text: string;
  hasCacheControl: boolean;
}

export interface InjectionSlots {
  /** Texts prepended to the native system content. */
  systemPrefix: string[];
  /** Texts appended after the native system content. */
  systemSuffix: string[];
  /** Tool definitions appended to the tools array. */
  toolsAppend: Array<Record<string, unknown>>;
}

export interface AgentContext {
  protocol: Protocol;
  model: string;
  stream: boolean;
  /** Extracted read-only view of native system content. */
  systemBlocks: SystemBlockView[];
  tools: Array<Record<string, unknown>>;
  /** Verbatim deep-cloned raw body; serialize rebuilds from this. */
  raw: Record<string, unknown>;
  injections: InjectionSlots;
}

export interface ProtocolAdapter {
  readonly protocol: Protocol;
  parse(rawBody: unknown): AgentContext;
  serialize(ctx: AgentContext): Record<string, unknown>;
}

export function emptyInjections(): InjectionSlots {
  return { systemPrefix: [], systemSuffix: [], toolsAppend: [] };
}

export function hasInjections(ctx: AgentContext): boolean {
  return (
    ctx.injections.systemPrefix.length > 0 ||
    ctx.injections.systemSuffix.length > 0 ||
    ctx.injections.toolsAppend.length > 0
  );
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function textBlock(text: string): Record<string, unknown> {
  return { type: "text", text };
}

export { textBlock };
