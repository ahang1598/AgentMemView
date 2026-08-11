import type { AggregateMetrics } from "./metrics/recall.js";

/** Eval report: config snapshot + metrics + per-question breakdown. */

export interface QuestionBreakdown {
  questionId: string;
  question: string;
  recallAt5: number;
  firstRelevantRank: number | null;
}

export interface EvalReport {
  dataset: string;
  runId: string;
  ranAt: string;
  config: Record<string, unknown>;
  metrics: AggregateMetrics;
  questions: QuestionBreakdown[];
  judge: "unavailable" | string;
}

export function buildReport(input: {
  dataset: string;
  runId: string;
  config: Record<string, unknown>;
  metrics: AggregateMetrics;
  questions: QuestionBreakdown[];
  judgeModel?: string | undefined;
}): EvalReport {
  return {
    dataset: input.dataset,
    runId: input.runId,
    ranAt: new Date().toISOString(),
    config: input.config,
    metrics: input.metrics,
    questions: input.questions,
    judge: input.judgeModel ?? "unavailable",
  };
}

export function renderMarkdown(report: EvalReport): string {
  const lines = [
    `# Eval report — ${report.dataset}`,
    "",
    `- run: ${report.runId}`,
    `- time: ${report.ranAt}`,
    `- judge: ${report.judge}`,
    "",
    "## Metrics",
    "",
    "| R@5 | R@10 | MRR | questions |",
    "|-----|------|-----|-----------|",
    `| ${(report.metrics.recallAt5 * 100).toFixed(1)}% | ${(report.metrics.recallAt10 * 100).toFixed(1)}% | ${report.metrics.mrr.toFixed(3)} | ${report.metrics.total} |`,
    "",
    "## Config snapshot",
    "",
    "```json",
    JSON.stringify(report.config, null, 2),
    "```",
    "",
    "## Per-question",
    "",
    "| id | R@5 | first relevant rank |",
    "|----|-----|---------------------|",
  ];
  for (const q of report.questions) {
    lines.push(
      `| ${q.questionId} | ${(q.recallAt5 * 100).toFixed(0)}% | ${q.firstRelevantRank ?? "-"} |`,
    );
  }
  return lines.join("\n");
}
