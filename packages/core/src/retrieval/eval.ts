import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FactsDao } from "../dao/l1.js";
import type { AgentMemViewDatabase } from "../db/database.js";
import { ensureVecTable } from "../db/vecTables.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import type { Scope } from "../scope/context.js";
import { RetrievalEngine } from "./engine.js";

/**
 * Synthetic retrieval eval harness (M1 baseline gate): 200 facts over 40
 * topics + 40 queries with topical relevance labels. Metric targets live in
 * the milestone DoD (R@5 >= 0.85).
 */

export interface EvalFixtureFact {
  content: string;
  topic: string;
}

export interface EvalFixtureQuery {
  query: string;
  topic: string;
}

export interface EvalFixture {
  facts: EvalFixtureFact[];
  queries: EvalFixtureQuery[];
}

export interface EvalReport {
  total: number;
  queries: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
}

export interface EvalOptions {
  db: AgentMemViewDatabase;
  scope: Scope;
  provider: EmbeddingProvider;
  fixture?: EvalFixture;
}

export function loadSyntheticFixture(): EvalFixture {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "eval-fixtures",
    "synthetic.json",
  );
  return JSON.parse(readFileSync(file, "utf8")) as EvalFixture;
}

export async function runRetrievalEval(options: EvalOptions): Promise<EvalReport> {
  const fixture = options.fixture ?? loadSyntheticFixture();
  const { db, scope, provider } = options;

  // index facts: l1 rows + FTS via DAO, vec rows directly (deterministic mock)
  const dao = new FactsDao(db, scope);
  const vecTable = ensureVecTable(db, provider.providerName, provider.model, provider.dims);
  const insertedIds: string[] = [];
  for (const fact of fixture.facts) {
    const row = dao.create({ content: fact.content });
    insertedIds.push(row.id);
  }
  const vectors = await provider.embed(fixture.facts.map((f) => f.content));
  const upsert = db.prepare(`INSERT INTO "${vecTable}" (fact_id, embedding) VALUES (?, ?)`);
  const indexAll = db.transaction(() => {
    vectors.forEach((vector, i) => {
      const id = insertedIds[i];
      if (id === undefined || vector === undefined) {
        return;
      }
      upsert.run(id, Buffer.from(new Float32Array(vector).buffer));
    });
  });
  indexAll();

  const topicsByFact = new Map<string, string>();
  fixture.facts.forEach((fact, i) => {
    const id = insertedIds[i];
    if (id !== undefined) {
      topicsByFact.set(id, fact.topic);
    }
  });

  const engine = new RetrievalEngine({ db, scope, provider, topK: 10 });
  let recall5 = 0;
  let recall10 = 0;
  let reciprocal = 0;
  for (const item of fixture.queries) {
    const relevantIds = new Set(
      [...topicsByFact.entries()].filter(([, topic]) => topic === item.topic).map(([id]) => id),
    );
    const { results } = await engine.search(item.query);
    const top5 = results.slice(0, 5).filter((r) => relevantIds.has(r.factId)).length;
    const top10 = results.slice(0, 10).filter((r) => relevantIds.has(r.factId)).length;
    recall5 += top5 / Math.max(1, relevantIds.size);
    recall10 += top10 / Math.max(1, relevantIds.size);
    const firstRank = results.findIndex((r) => relevantIds.has(r.factId));
    if (firstRank >= 0) {
      reciprocal += 1 / (firstRank + 1);
    }
  }
  const queryCount = fixture.queries.length;
  return {
    total: fixture.facts.length,
    queries: queryCount,
    recallAt5: recall5 / queryCount,
    recallAt10: recall10 / queryCount,
    mrr: reciprocal / queryCount,
  };
}
