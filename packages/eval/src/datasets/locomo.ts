/**
 * LoCoMo loader: JSON array of conversations with qa pairs carrying evidence
 * pointers (turn indices).
 */

export interface LocoMoQaPair {
  question: string;
  answer: string;
  /** evidence pointers: [conversationIndex, turnIndex] pairs */
  evidence: Array<{ turn: number }>;
  category: string;
}

export interface LocoMoConversation {
  conversationId: string;
  turns: Array<{ role: string; content: string }>;
  qaPairs: LocoMoQaPair[];
}

export class LocoMoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocoMoError";
  }
}

export function parseLocoMo(text: string): LocoMoConversation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LocoMoError("invalid JSON document");
  }
  if (!Array.isArray(parsed)) {
    throw new LocoMoError("top-level must be an array of conversations");
  }
  return parsed.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new LocoMoError(`conversation[${index}] is not an object`);
    }
    const record = item as Record<string, unknown>;
    const observation = record.observation;
    const turns: Array<{ role: string; content: string }> = [];
    if (Array.isArray(observation)) {
      for (const turn of observation) {
        if (turn === null || typeof turn !== "object") {
          continue;
        }
        const t = turn as Record<string, unknown>;
        if (typeof t.role === "string" && typeof t.content === "string") {
          turns.push({ role: t.role, content: t.content });
        }
      }
    }
    const qaRaw = record.qa_pairs;
    const qaPairs: LocoMoQaPair[] = [];
    if (Array.isArray(qaRaw)) {
      for (const qa of qaRaw) {
        if (qa === null || typeof qa !== "object") {
          continue;
        }
        const q = qa as Record<string, unknown>;
        if (typeof q.question !== "string" || typeof q.answer !== "string") {
          continue;
        }
        const evidenceRaw = q.evidence;
        const evidence: Array<{ turn: number }> = [];
        if (Array.isArray(evidenceRaw)) {
          for (const e of evidenceRaw) {
            if (typeof e === "number") {
              evidence.push({ turn: e });
            }
          }
        }
        qaPairs.push({
          question: q.question,
          answer: q.answer,
          evidence,
          category: typeof q.category === "string" ? q.category : "single-hop",
        });
      }
    }
    return {
      conversationId:
        typeof record.conversation_id === "string" ? record.conversation_id : `conv-${index}`,
      turns,
      qaPairs,
    };
  });
}
