import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { AgentMemViewDatabase } from "../db/database.js";
import { ensureVecTable, vecTableName } from "../db/vecTables.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import type { EventBus } from "../events/bus.js";
import { AGENT_VISIBILITY_SQL, type Scope, validateScope } from "../scope/context.js";
import { ebbinghausFactor } from "./decay.js";
import { entityBoostedFactIds } from "./entities.js";
import { buildFtsMatch, queryWords } from "./keyword.js";
import { type RankedHit, rrf } from "./rrf.js";

/**
 * Six-stage retrieval pipeline (Spec section 6, locked for v1):
 * prefilter → fts ∥ vec → RRF(k=60) → decay+entity boost → active top-k → trace.
 * Zero LLM calls at retrieval time.
 */

export const DEFAULT_TOP_K = 8;
const CHANNEL_LIMIT = 30;
const CHANNEL_FETCH = 100;

export interface EngineOptions {
  db: AgentMemViewDatabase;
  scope: Scope;
  provider: EmbeddingProvider;
  bus?: EventBus | undefined;
  nowMs?: (() => number) | undefined;
  topK?: number | undefined;
}

export interface SearchResult {
  factId: string;
  content: string;
  score: number;
  decayFactor: number;
  entityBoost: boolean;
}

export interface SearchOutput {
  results: SearchResult[];
  traceId: string;
}

interface Candidate {
  id: string;
  content: string;
  pinned: boolean;
  halfLifeDays: number;
  lastAccessedAt: string;
}

interface StageRecord {
  stage: string;
  candidates: string[];
}

export class RetrievalEngine {
  private readonly db: AgentMemViewDatabase;
  private readonly scope: Scope;
  private readonly provider: EmbeddingProvider;
  private readonly bus?: EventBus | undefined;
  private readonly nowMs: () => number;
  private readonly topK: number;

  constructor(options: EngineOptions) {
    this.db = options.db;
    this.scope = validateScope(options.scope);
    this.provider = options.provider;
    this.bus = options.bus;
    this.nowMs = options.nowMs ?? Date.now;
    this.topK = options.topK ?? DEFAULT_TOP_K;
  }

  async search(query: string, options: { sessionId?: string } = {}): Promise<SearchOutput> {
    const started = performance.now();

    // stage 1: scope prefilter (SQL WHERE cuts the candidate set)
    const candidates = this.prefilter();
    const candidateIds = new Set(candidates.map((c) => c.id));
    const stages: StageRecord[] = [
      { stage: "prefilter", candidates: candidates.slice(0, 500).map((c) => c.id) },
    ];

    // stage 2: dual channels in parallel
    const [ftsRanked, vecRanked] = await Promise.all([
      Promise.resolve(this.ftsChannel(query, candidateIds)),
      this.vecChannel(query, candidateIds),
    ]);
    stages.push({ stage: "fts", candidates: ftsRanked.map((h) => h.id) });
    stages.push({ stage: "vec", candidates: vecRanked.map((h) => h.id) });

    // stage 3: RRF fusion
    const fused = rrf([ftsRanked, vecRanked], 60);
    stages.push({ stage: "rrf", candidates: fused.map((f) => f.id) });

    // stage 4: decay weighting + entity boost
    const boostedIds = entityBoostedFactIds(this.db, this.scope.spaceId, query);
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    const nowMs = this.nowMs();
    const scored: SearchResult[] = [];
    for (const hit of fused) {
      const candidate = candidateMap.get(hit.id);
      if (candidate === undefined) {
        continue;
      }
      const decayFactor = ebbinghausFactor({
        lastAccessedAt: candidate.lastAccessedAt,
        halfLifeDays: candidate.halfLifeDays,
        pinned: candidate.pinned,
        nowMs,
      });
      const entityBoost = boostedIds.has(hit.id);
      scored.push({
        factId: hit.id,
        content: candidate.content,
        score: hit.score * decayFactor + (entityBoost ? 0.1 : 0),
        decayFactor,
        entityBoost,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    stages.push({ stage: "decay", candidates: scored.map((s) => s.factId) });

    // stage 5: status=active already enforced by prefilter; cut to top-k
    const results = scored.slice(0, this.topK);
    stages.push({ stage: "final", candidates: results.map((r) => r.factId) });

    // stage 6: trace persistence + event
    const latencyMs = Math.max(performance.now() - started, 0.001);
    const traceId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO retrieval_traces (id, session_id, query, scope_json, stages_json, results_json, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        traceId,
        options.sessionId ?? null,
        query,
        JSON.stringify(this.scope),
        JSON.stringify(stages),
        JSON.stringify(results),
        latencyMs,
        new Date(nowMs).toISOString(),
      );
    this.bus?.publish("retrieval.completed", {
      traceId,
      query,
      results: results.length,
    });
    return { results, traceId };
  }

  private prefilter(): Candidate[] {
    const agentClause =
      this.scope.agentId === undefined
        ? "space_id = ?"
        : `space_id = ? AND ${AGENT_VISIBILITY_SQL}`;
    const binds: Array<string | null> =
      this.scope.agentId === undefined
        ? [this.scope.spaceId]
        : [this.scope.spaceId, this.scope.agentId];
    const rows = this.db
      .prepare(
        `SELECT id, content, pinned, half_life_days, last_accessed_at
         FROM l1_facts WHERE ${agentClause} AND status = 'active'`,
      )
      .all(...binds) as Array<{
      id: string;
      content: string;
      pinned: number;
      half_life_days: number;
      last_accessed_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      pinned: row.pinned === 1,
      halfLifeDays: row.half_life_days,
      lastAccessedAt: row.last_accessed_at,
    }));
  }

  private ftsChannel(query: string, candidateIds: Set<string>): RankedHit[] {
    const match = buildFtsMatch(query);
    let rows: Array<{ fact_id: string }>;
    if (match !== null) {
      rows = this.db
        .prepare(
          `SELECT fact_id FROM l1_facts_fts WHERE l1_facts_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(match, CHANNEL_FETCH) as Array<{ fact_id: string }>;
    } else {
      // trigram MATCH needs >= 3 codepoints; degrade to LIKE scan
      rows = [];
      for (const word of queryWords(query)) {
        const hits = this.db
          .prepare("SELECT fact_id FROM l1_facts_fts WHERE content LIKE ? LIMIT ?")
          .all(`%${word}%`, CHANNEL_FETCH) as Array<{ fact_id: string }>;
        rows.push(...hits);
      }
    }
    return toRanked(rows, candidateIds);
  }

  private async vecChannel(query: string, candidateIds: Set<string>): Promise<RankedHit[]> {
    const { providerName, model, dims } = this.provider;
    const table = vecTableName(providerName, model, dims);
    const exists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (exists === undefined) {
      return [];
    }
    const [vector] = await this.provider.embed([query]);
    if (vector === undefined || vector.length !== dims) {
      return [];
    }
    const buffer = Buffer.from(new Float32Array(vector).buffer);
    const rows = this.db
      .prepare(`SELECT fact_id, distance FROM "${table}" WHERE embedding MATCH ? AND k = ?`)
      .all(buffer, CHANNEL_FETCH) as Array<{ fact_id: string; distance: number }>;
    return toRanked(rows, candidateIds);
  }
}

function toRanked(rows: Array<{ fact_id: string }>, candidateIds: Set<string>): RankedHit[] {
  const seen = new Set<string>();
  const ranked: RankedHit[] = [];
  for (const row of rows) {
    if (!candidateIds.has(row.fact_id) || seen.has(row.fact_id)) {
      continue;
    }
    seen.add(row.fact_id);
    ranked.push({ id: row.fact_id, rank: ranked.length + 1 });
    if (ranked.length >= CHANNEL_LIMIT) {
      break;
    }
  }
  return ranked;
}

/** Ensure the vec table for the provider triple exists (used by indexers). */
export function ensureEngineVecTable(
  db: AgentMemViewDatabase,
  provider: EmbeddingProvider,
): string {
  return ensureVecTable(db, provider.providerName, provider.model, provider.dims);
}
