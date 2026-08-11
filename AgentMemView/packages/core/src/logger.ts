import pino, { type Logger } from "pino";

export type { Logger };

/**
 * Create a pino logger emitting JSON lines (one JSON object per line),
 * suitable for pipe-friendly observability (M2 onwards).
 */
export function createLogger(name = "agentmemview", level?: string): Logger {
  return pino({
    name,
    level: level ?? process.env.AGENTMEMVIEW_LOG_LEVEL ?? "info",
  });
}
