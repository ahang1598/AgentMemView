#!/usr/bin/env node
// agentmemview-eval: retrieval evaluation CLI.
// Usage: agentmemview-eval run <dataset> [--core <url>] [--sample <n>]
//
// Built-in synthetic mode: N topics x 5 facts; each query targets one
// topic, relevance = that topic's five fact ids (tracked via ingest order).
// External datasets (LongMemEval-S / LoCoMo) plug in via the same drivers.
import { EvalCoreClient } from "../dist/drivers/coreClient.js";
import { aggregate, recallAtK, reciprocalRank } from "../dist/metrics/recall.js";
import { buildReport, renderMarkdown } from "../dist/report.js";

const args = process.argv.slice(2);
if (args[0] !== "run" || args[1] === undefined) {
  console.log("usage: agentmemview-eval run <dataset> [--core <url>] [--sample <n>]");
  process.exit(1);
}
const dataset = args[1];
let coreUrl = "http://127.0.0.1:8620";
let sample = 40;
for (let i = 2; i < args.length; i += 1) {
  if (args[i] === "--core" && args[i + 1] !== undefined) {
    coreUrl = args[i + 1];
    i += 1;
  } else if (args[i] === "--sample" && args[i + 1] !== undefined) {
    sample = Number.parseInt(args[i + 1], 10);
    i += 1;
  }
}

const run = async () => {
  const runId = `cli-${Date.now()}`;
  const client = new EvalCoreClient({ baseUrl: coreUrl });
  const { spaceId } = await client.ensureEvalSpace(dataset, runId);
  console.log(`eval space ready: ${spaceId} (topics=${sample})`);

  const FACTS_PER_TOPIC = 5;
  const texts = [];
  for (let t = 0; t < sample; t += 1) {
    const topic = `主题${String(t).padStart(2, "0")}`;
    for (let f = 0; f < FACTS_PER_TOPIC; f += 1) {
      texts.push(`${topic} 的第${f + 1}条记忆细节记录`);
    }
  }
  const ids = await client.ingestFacts(spaceId, texts);

  const questions = [];
  for (let t = 0; t < sample; t += 1) {
    questions.push({
      id: `q${t}`,
      query: `主题${String(t).padStart(2, "0")} 记忆细节`,
      relevantIds: new Set(ids.slice(t * FACTS_PER_TOPIC, (t + 1) * FACTS_PER_TOPIC)),
    });
  }

  const ranked = [];
  const breakdown = [];
  for (const q of questions) {
    const { factIds, traceId } = await client.retrieve(spaceId, q.query, 10);
    ranked.push({ retrieved: factIds, relevant: q.relevantIds });
    const firstRank = factIds.findIndex((id) => q.relevantIds.has(id));
    breakdown.push({
      questionId: q.id,
      question: q.query,
      recallAt5: recallAtK({ retrieved: factIds, relevant: q.relevantIds }, 5),
      firstRelevantRank: firstRank >= 0 ? firstRank + 1 : null,
    });
    void traceId;
  }
  const metrics = aggregate(ranked);
  const mrr = ranked.reduce((sum, r) => sum + reciprocalRank(r), 0) / Math.max(1, ranked.length);
  void mrr;
  const report = buildReport({
    dataset,
    runId,
    config: { coreUrl, topK: 10, factsPerTopic: FACTS_PER_TOPIC },
    metrics,
    questions: breakdown,
  });
  console.log(renderMarkdown(report));
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
