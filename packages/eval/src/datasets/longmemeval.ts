/**
 * LongMemEval-S loader: JSONL with one question per line. Sessions are
 * grouped by session_id. Corrupt lines throw with their 1-based line number.
 */

export interface LongMemEvalSession {
  sessionId: string;
  turns: Array<{ role: string; content: string }>;
}

export interface LongMemEvalQuestion {
  questionId: string;
  question: string;
  /** session ids containing the supporting evidence */
  evidenceSessionIds: string[];
}

export interface LongMemEvalDataset {
  sessions: LongMemEvalSession[];
  questions: LongMemEvalQuestion[];
}

export class DatasetError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = "DatasetError";
  }
}

export function parseLongMemEvalS(text: string): LongMemEvalDataset {
  const sessions = new Map<string, LongMemEvalSession>();
  const questions: LongMemEvalQuestion[] = [];
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0) {
      return;
    }
    const lineNo = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new DatasetError("invalid JSON", lineNo);
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new DatasetError("record must be an object", lineNo);
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.question_id === "string") {
      // question record
      if (typeof record.question !== "string") {
        throw new DatasetError("question record missing question text", lineNo);
      }
      const evidence = record.evidence_session_ids;
      questions.push({
        questionId: record.question_id,
        question: record.question,
        evidenceSessionIds: Array.isArray(evidence)
          ? evidence.filter((e): e is string => typeof e === "string")
          : [],
      });
      return;
    }
    // session turn record
    if (typeof record.session_id !== "string") {
      throw new DatasetError("record missing session_id/question_id", lineNo);
    }
    if (typeof record.role !== "string" || typeof record.content !== "string") {
      throw new DatasetError("session record missing role/content", lineNo);
    }
    let session = sessions.get(record.session_id);
    if (session === undefined) {
      session = { sessionId: record.session_id, turns: [] };
      sessions.set(record.session_id, session);
    }
    session.turns.push({ role: record.role, content: record.content });
  });
  return { sessions: [...sessions.values()], questions };
}
