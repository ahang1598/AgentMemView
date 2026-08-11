import { describe, expect, it } from "vitest";
import { aggregate, recallAtK, reciprocalRank } from "../src/metrics/recall.js";
import { buildReport, renderMarkdown } from "../src/report.js";

describe("metrics (M5-03)", () => {
  it("recall@k hand-computed fixtures pass", () => {
    // case 1: 2 relevant, both in top5 → 1.0
    const r1 = { retrieved: ["a", "b", "c"], relevant: new Set(["a", "b"]) };
    expect(recallAtK(r1, 5)).toBe(1);
    // case 2: 2 relevant, one in top5 → 0.5
    const r2 = { retrieved: ["x", "y", "z", "a"], relevant: new Set(["a", "b"]) };
    expect(recallAtK(r2, 5)).toBe(0.5);
    // case 3: first relevant at rank 3 → RR = 1/3
    const r3 = { retrieved: ["x", "y", "a"], relevant: new Set(["a"]) };
    expect(reciprocalRank(r3)).toBeCloseTo(1 / 3, 10);
  });

  it("aggregate averages across questions", () => {
    const metrics = aggregate([
      { retrieved: ["a"], relevant: new Set(["a"]) },
      { retrieved: ["x", "a"], relevant: new Set(["a"]) },
    ]);
    expect(metrics.recallAt5).toBe(1);
    expect(metrics.mrr).toBeCloseTo((1 + 0.5) / 2, 10);
    expect(metrics.total).toBe(2);
  });

  it("judge aggregates per-question verdicts with model name recorded", () => {
    const report = buildReport({
      dataset: "locomo",
      runId: "run-1",
      config: { topK: 8 },
      metrics: aggregate([]),
      questions: [],
      judgeModel: "gpt-5-mini",
    });
    expect(report.judge).toBe("gpt-5-mini");
    const unavailable = buildReport({
      dataset: "locomo",
      runId: "run-2",
      config: {},
      metrics: aggregate([]),
      questions: [],
    });
    expect(unavailable.judge).toBe("unavailable");
  });
});

describe("report (M5-04)", () => {
  it("report contains config snapshot, metrics, breakdown, timestamp", () => {
    const report = buildReport({
      dataset: "longmemeval-s",
      runId: "run-9",
      config: { rrfK: 60, channelTopK: 30 },
      metrics: { recallAt5: 0.92, recallAt10: 0.97, mrr: 0.88, total: 40 },
      questions: [{ questionId: "q1", question: "偏好？", recallAt5: 1, firstRelevantRank: 1 }],
    });
    expect(report.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.config.rrfK).toBe(60);
    expect(report.metrics.recallAt5).toBe(0.92);
    expect(report.questions).toHaveLength(1);
    const md = renderMarkdown(report);
    expect(md).toContain("92.0%");
    expect(md).toContain("q1");
    expect(md).toContain('"rrfK": 60');
  });
});
