import { randomUUID } from "node:crypto";
import type { AgentMemViewDatabase } from "../db/database.js";
import type { EventBus } from "../events/bus.js";
import { type RedactionRule, redact } from "../redaction/redactor.js";

/**
 * L0 raw-message persistence: redact → envelope strip (user msgs) → chunk →
 * batch insert → publish l0.appended. Mirrors MemoryProxy's write-back path.
 */

export const L0_CHUNK_SIZE = 8192;

/**
 * Harness/editor envelope tags stripped from user messages before storage
 * (learned from MemoryProxy's extractUserQueryText): IDE-injected context is
 * noise for memory extraction; only the user's own text matters.
 */
const ENVELOPE_TAGS = [
  "additional_data",
  "system-reminder",
  "project_instructions",
  "user_info",
  "environment_details",
  "attached_files",
  "memory_overview",
  "knowledge_module_tree",
];

export interface IncomingMessage {
  turn: number;
  role: string;
  content: string;
}

export function stripEnvelope(content: string): string {
  let text = content;
  for (const tag of ENVELOPE_TAGS) {
    const regex = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "g");
    text = text.replace(regex, "");
  }
  const trimmed = text.trim();
  // Never destroy the message entirely: fall back to the original content.
  return trimmed.length > 0 ? trimmed : content.trim();
}

export class L0Dao {
  constructor(
    private readonly db: AgentMemViewDatabase,
    private readonly bus: EventBus,
    private readonly rules?: RedactionRule[],
  ) {}

  appendMessages(sessionId: string, messages: IncomingMessage[]): number {
    const insert = this.db.prepare(
      `INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    let rowCount = 0;
    const write = this.db.transaction(() => {
      for (const message of messages) {
        const enveloped =
          message.role === "user" ? stripEnvelope(message.content) : message.content;
        const { text, count } = redact(enveloped, this.rules);
        const chunks = chunkText(text, L0_CHUNK_SIZE);
        let seq = 0;
        for (const chunk of chunks) {
          insert.run(
            randomUUID(),
            sessionId,
            message.turn,
            seq,
            message.role,
            chunk,
            count,
            Math.ceil(chunk.length / 4),
            now,
          );
          seq += 1;
          rowCount += 1;
        }
      }
    });
    write();
    this.bus.publish("l0.appended", {
      sessionId,
      messages: messages.length,
      rows: rowCount,
    });
    return rowCount;
  }
}

export function chunkText(text: string, size: number): string[] {
  if (text.length === 0) {
    return [""];
  }
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks;
}
