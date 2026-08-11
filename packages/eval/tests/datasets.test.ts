import { describe, expect, it } from "vitest";
import { LocoMoError, parseLocoMo } from "../src/datasets/locomo.js";
import { DatasetError, parseLongMemEvalS } from "../src/datasets/longmemeval.js";

const JSONL_FIXTURE = [
  JSON.stringify({ session_id: "s1", role: "user", content: "我喜欢 pnpm" }),
  JSON.stringify({ session_id: "s1", role: "assistant", content: "好的" }),
  JSON.stringify({ session_id: "s2", role: "user", content: "部署在阿里云" }),
  JSON.stringify({
    question_id: "q1",
    question: "我喜欢什么包管理器？",
    evidence_session_ids: ["s1"],
  }),
].join("\n");

describe("dataset loaders (M5-01)", () => {
  it("longmemeval loader validates schema and counts sessions/questions", () => {
    const dataset = parseLongMemEvalS(JSONL_FIXTURE);
    expect(dataset.sessions).toHaveLength(2);
    expect(dataset.sessions.find((s) => s.sessionId === "s1")?.turns).toHaveLength(2);
    expect(dataset.questions).toHaveLength(1);
    expect(dataset.questions[0]?.evidenceSessionIds).toEqual(["s1"]);
  });

  it("corrupt line → error with line number", () => {
    const bad = `${JSON.stringify({ session_id: "s1", role: "user", content: "x" })}\nnot json`;
    try {
      parseLongMemEvalS(bad);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetError);
      expect((err as DatasetError).line).toBe(2);
    }
  });

  it("locomo loader extracts qa pairs with evidence pointers", () => {
    const doc = JSON.stringify([
      {
        conversation_id: "c1",
        observation: [
          { role: "user", content: "你好" },
          { role: "assistant", content: "你好！" },
        ],
        qa_pairs: [
          {
            question: "招呼是什么？",
            answer: "你好",
            evidence: [0],
            category: "single-hop",
          },
        ],
      },
    ]);
    const conversations = parseLocoMo(doc);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.turns).toHaveLength(2);
    expect(conversations[0]?.qaPairs[0]?.evidence).toEqual([{ turn: 0 }]);
  });

  it("locomo rejects non-array documents", () => {
    expect(() => parseLocoMo("{}")).toThrow(LocoMoError);
  });
});
