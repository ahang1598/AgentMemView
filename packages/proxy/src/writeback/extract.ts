/**
 * Turn extraction for L0 write-back. Archive discipline (MemoryProxy rule):
 * only the final assistant message of a round that carries NO tool_use
 * triggers round-level archival; intra-round tool_use assistants are stored
 * as part of the round but never treated as round terminators.
 */

export interface ExtractedMessage {
  turn: number;
  role: string;
  content: string;
}

interface LooseMessage {
  role?: unknown;
  content?: unknown;
}

export function isRoundFinalAssistant(message: unknown): boolean {
  if (message === null || typeof message !== "object") {
    return false;
  }
  const msg = message as LooseMessage;
  if (msg.role !== "assistant") {
    return false;
  }
  if (typeof msg.content === "string") {
    return true;
  }
  if (Array.isArray(msg.content)) {
    return !msg.content.some(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "tool_use",
    );
  }
  return false;
}

function contentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block === null || typeof block !== "object") {
        continue;
      }
      const typed = block as Record<string, unknown>;
      if (typed.type === "text" && typeof typed.text === "string") {
        parts.push(typed.text);
      } else if (typed.type === "tool_use" && typeof typed.name === "string") {
        parts.push(`[tool_use: ${typed.name}]`);
      } else if (typed.type === "tool_result" && typeof typed.content === "string") {
        parts.push(`[tool_result] ${typed.content}`);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/** Extract storable messages from an agent request/response pair. */
export function extractTurnMessages(body: unknown, turn: number): ExtractedMessage[] {
  if (body === null || typeof body !== "object") {
    return [];
  }
  const messages = (body as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  const out: ExtractedMessage[] = [];
  for (const message of messages) {
    if (message === null || typeof message !== "object") {
      continue;
    }
    const msg = message as LooseMessage;
    if (typeof msg.role !== "string") {
      continue;
    }
    out.push({ turn, role: msg.role, content: contentToString(msg.content) });
  }
  return out;
}
