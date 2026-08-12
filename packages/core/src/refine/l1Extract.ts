import { z } from "zod";
import { FactsDao } from "../dao/l1.js";
import type { AgentMemViewDatabase } from "../db/database.js";
import type { LLMProvider } from "../providers/llm/types.js";
import type { Scope } from "../scope/context.js";

/**
 * L1 refinement: extract atomic facts from a finished session.
 * Two strategies share one interface (Spec section 5): LLM single add-call
 * (mem0-style, exactly one LLM call on the write path) and an offline
 * heuristic. Dirty LLM output degrades to heuristic instead of erroring.
 */

export interface SessionMessage {
  id: string;
  turn: number;
  role: string;
  content: string;
}

export interface ExtractedFactOp {
  action: "ADD" | "UPDATE";
  content: string;
  supersedes?: string | undefined;
}

export interface RefineStrategy {
  readonly name: "llm" | "heuristic";
  propose(messages: SessionMessage[]): Promise<ExtractedFactOp[]>;
}

export interface ExtractResult {
  inserted: number;
  superseded: number;
  degraded: boolean;
}

const llmOutputSchema = z.object({
  facts: z
    .array(
      z.object({
        action: z.enum(["ADD", "UPDATE"]),
        content: z.string().min(1).max(2000),
        supersedes: z.string().optional(),
      }),
    )
    .max(50),
});

const EXTRACT_PROMPT = [
  "从以下会话消息中抽取值得长期保留的原子事实（偏好/决策/约定/环境配置）。",
  '只输出 JSON：{"facts":[{"action":"ADD"|"UPDATE","content":"...","supersedes":"与库存矛盾的旧事实原文（仅 UPDATE 时）"}]}',
  '没有可抽取内容时输出 {"facts":[]}。不要输出任何其他文本。',
].join("\n");

export class LlmStrategy implements RefineStrategy {
  readonly name = "llm";

  constructor(private readonly llm: LLMProvider) {}

  async propose(messages: SessionMessage[]): Promise<ExtractedFactOp[]> {
    const transcript = messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n")
      .slice(0, 20_000);
    const result = await this.llm.chat([
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: transcript },
    ]);
    const parsed = llmOutputSchema.safeParse(parseLlmJson(result.text));
    if (!parsed.success) {
      throw new DegradedSignal(`llm output failed schema validation: ${parsed.error.message}`);
    }
    return parsed.data.facts.map((fact) => ({
      action: fact.action,
      content: fact.content,
      ...(fact.supersedes !== undefined ? { supersedes: fact.supersedes } : {}),
    }));
  }
}

/** Thrown when LLM output is unusable; caller falls back to heuristic. */
export class DegradedSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DegradedSignal";
  }
}

/**
 * Small models (glm-4-flash etc.) wrap JSON in markdown fences or prepend
 * prose; extract the JSON object before parsing.
 */
export function parseLlmJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new DegradedSignal("no JSON object found in llm output");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

const REMEMBER_PATTERNS = [/^记住[：:]\s*(.+)$/s, /^remember[：:]\s*(.+)$/is];
const CORRECTION_PATTERN = /以后用\s*(\S+)\s*不用\s*(\S+)/;

export class HeuristicStrategy implements RefineStrategy {
  readonly name = "heuristic";

  async propose(messages: SessionMessage[]): Promise<ExtractedFactOp[]> {
    const ops: ExtractedFactOp[] = [];
    for (const message of messages) {
      if (message.role !== "user") {
        continue;
      }
      const text = message.content.trim();
      for (const pattern of REMEMBER_PATTERNS) {
        const match = pattern.exec(text);
        if (match !== null && match[1] !== undefined) {
          ops.push({ action: "ADD", content: match[1].trim() });
        }
      }
      const correction = CORRECTION_PATTERN.exec(text);
      if (correction !== null && correction[1] !== undefined && correction[2] !== undefined) {
        ops.push({ action: "ADD", content: `使用 ${correction[1]} 而非 ${correction[2]}` });
      }
    }
    return ops;
  }
}

function loadSessionMessages(db: AgentMemViewDatabase, sessionId: string): SessionMessage[] {
  const rows = db
    .prepare(
      `SELECT id, turn, role, content FROM l0_messages
       WHERE session_id = ? ORDER BY turn, seq`,
    )
    .all(sessionId) as Array<{ id: string; turn: number; role: string; content: string }>;
  return rows;
}

export interface RunL1ExtractInput {
  db: AgentMemViewDatabase;
  scope: Scope;
  sessionId: string;
  strategy: RefineStrategy;
}

export async function runL1Extract(input: RunL1ExtractInput): Promise<ExtractResult> {
  const { db, scope, sessionId } = input;
  const messages = loadSessionMessages(db, sessionId);
  if (messages.length === 0) {
    return { inserted: 0, superseded: 0, degraded: false };
  }
  let ops: ExtractedFactOp[];
  let degraded = false;
  try {
    ops = await input.strategy.propose(messages);
  } catch (err) {
    if (err instanceof DegradedSignal || err instanceof SyntaxError) {
      // dirty LLM output: degrade to heuristic, never fail the job
      ops = await new HeuristicStrategy().propose(messages);
      degraded = true;
    } else {
      throw err;
    }
  }
  const dao = new FactsDao(db, scope);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const anchorMessageId = lastUser?.id ?? messages[0]?.id;
  let inserted = 0;
  let superseded = 0;
  for (const op of ops) {
    if (op.action === "UPDATE" && op.supersedes !== undefined) {
      const old = dao.list().find((f) => f.content === op.supersedes);
      if (old !== undefined) {
        dao.update(old.id, { content: op.content });
        superseded += 1;
        inserted += 1;
        continue;
      }
    }
    const created = dao.create({
      content: op.content,
      ...(anchorMessageId !== undefined ? { sourceMessageId: anchorMessageId } : {}),
    });
    if (!created.deduped) {
      inserted += 1;
    }
  }
  return { inserted, superseded, degraded };
}
