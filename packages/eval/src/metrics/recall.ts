/** R@k / MRR metrics with hand-verifiable semantics. */

export interface RankedResult {
  /** ordered retrieved ids, most relevant first */
  retrieved: string[];
  /** ground-truth relevant ids */
  relevant: Set<string>;
}

export function recallAtK(result: RankedResult, k: number): number {
  if (result.relevant.size === 0) {
    return 0;
  }
  const topK = result.retrieved.slice(0, k);
  const hits = topK.filter((id) => result.relevant.has(id)).length;
  return hits / result.relevant.size;
}

export function reciprocalRank(result: RankedResult): number {
  for (let i = 0; i < result.retrieved.length; i += 1) {
    const id = result.retrieved[i];
    if (id !== undefined && result.relevant.has(id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export interface AggregateMetrics {
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  total: number;
}

export function aggregate(results: RankedResult[]): AggregateMetrics {
  if (results.length === 0) {
    return { recallAt5: 0, recallAt10: 0, mrr: 0, total: 0 };
  }
  let r5 = 0;
  let r10 = 0;
  let mrr = 0;
  for (const result of results) {
    r5 += recallAtK(result, 5);
    r10 += recallAtK(result, 10);
    mrr += reciprocalRank(result);
  }
  const n = results.length;
  return { recallAt5: r5 / n, recallAt10: r10 / n, mrr: mrr / n, total: n };
}
