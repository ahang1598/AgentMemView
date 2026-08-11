import { randomUUID } from "node:crypto";
import type { AgentMemViewDatabase } from "../db/database.js";

/**
 * L2 scenario index (Spec section 5). Default (no-LLM) mode: rule-based
 * title + first-sentence summary + token estimate. LLM-enhanced summaries
 * arrive later as queued jobs when the gateway capability is on.
 */

export interface SummarizeInput {
  sessionId: string;
  spaceId: string;
}

export function summarizeSession(
  db: AgentMemViewDatabase,
  input: SummarizeInput,
): string | undefined {
  const rows = db
    .prepare(`SELECT role, content FROM l0_messages WHERE session_id = ? ORDER BY turn, seq`)
    .all(input.sessionId) as Array<{ role: string; content: string }>;
  if (rows.length === 0) {
    return undefined;
  }
  const firstUser = rows.find((r) => r.role === "user");
  const title = truncate((firstUser?.content ?? "会话").trim(), 40);
  const summary = truncate(rows.map((r) => r.content).join("；"), 200);
  const totalChars = rows.reduce((sum, r) => sum + r.content.length, 0);
  const tokenEstimate = Math.ceil(totalChars / 4);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO l2_scenarios (id, space_id, title, summary, token_estimate, source_session_ids_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.spaceId, title, summary, tokenEstimate, JSON.stringify([input.sessionId]), now);
  return id;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
