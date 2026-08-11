/**
 * Request classification: main / fork / sidequery (Spec section 7 stage 2).
 *
 * Heuristic v1 (rule table is configurable later):
 * - body.forkOf present → fork (conversation branch; injection skipped);
 * - metadata.user_id containing "sidequery" → sidequery (auxiliary calls
 *   emitted by agents for summarization/classification);
 * - max_tokens <= 50 → sidequery (tiny helper calls);
 * - otherwise main.
 * sidequery/fork requests skip injection entirely (MemoryProxy discipline).
 */

export type RequestClass = "main" | "sidequery" | "fork";

const SIDQUERY_MAX_TOKENS = 50;

export function classifyRequestBody(body: unknown): RequestClass {
  if (body === null || typeof body !== "object") {
    return "main";
  }
  const record = body as Record<string, unknown>;
  if (typeof record.forkOf === "string" && record.forkOf.length > 0) {
    return "fork";
  }
  const metadata = record.metadata;
  if (metadata !== null && typeof metadata === "object") {
    const userId = (metadata as Record<string, unknown>).user_id;
    if (typeof userId === "string" && userId.toLowerCase().includes("sidequery")) {
      return "sidequery";
    }
  }
  const maxTokens = record.max_tokens;
  if (typeof maxTokens === "number" && maxTokens <= SIDQUERY_MAX_TOKENS) {
    return "sidequery";
  }
  return "main";
}
