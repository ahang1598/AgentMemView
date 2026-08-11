import type { JobQueue } from "./queue.js";

/**
 * Refinement scheduler: fans session-end events into queue jobs. Capability
 * gates are evaluated at dispatch time — LLM off means heuristic-only jobs
 * (AC-02 offline discipline).
 */

export interface SessionRefineInput {
  sessionId: string;
  spaceId: string;
  llmEnabled: boolean;
}

export function scheduleSessionRefine(queue: JobQueue, input: SessionRefineInput): string {
  return queue.enqueue("refine.l1", {
    sessionId: input.sessionId,
    spaceId: input.spaceId,
    strategy: input.llmEnabled ? "llm" : "heuristic",
  });
}
