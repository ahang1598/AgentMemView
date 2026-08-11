import { createHash } from "node:crypto";

/**
 * Prewarm cache + KV-cache prefix stability monitoring (AC-03).
 * The injected prefix is a pure function of (space profile/scenarios/skills),
 * so per-turn MD5 of the serialized blocks must stay identical; a change
 * means the KV-cache prefix was blown.
 */

export type InjectionBlockKind = "profile" | "scenario-index" | "skills-list" | "memory-guide";

export interface InjectionBlockRecord {
  kind: InjectionBlockKind;
  tokens: number;
  content: string;
}

export interface InjectionRecord {
  sessionId: string;
  turn: number;
  blocks: InjectionBlockRecord[];
  tokenJson: Record<string, number>;
  cachePrefixMd5: string;
  createdAt: string;
}

/** Canonical hash of the injected prefix content. */
export function computePrefixMd5(blocks: InjectionBlockRecord[]): string {
  const canonical = JSON.stringify(blocks.map((b) => ({ kind: b.kind, content: b.content })));
  return createHash("md5").update(canonical, "utf8").digest("hex");
}

/** Session-level cache of the last prefix MD5 (monitoring, not mutation). */
export class PrewarmCache {
  readonly #bySession = new Map<string, string>();

  get(sessionKey: string): string | undefined {
    return this.#bySession.get(sessionKey);
  }

  set(sessionKey: string, md5: string): void {
    this.#bySession.set(sessionKey, md5);
  }

  /** True when the prefix changed since last turn (KV-cache blown). */
  detectInstability(sessionKey: string, md5: string): boolean {
    const previous = this.#bySession.get(sessionKey);
    return previous !== undefined && previous !== md5;
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
