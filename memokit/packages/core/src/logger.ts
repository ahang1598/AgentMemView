import pino, { type Logger } from "pino";

export type { Logger };

/**
 * Create a pino logger emitting JSON lines (one JSON object per line),
 * suitable for pipe-friendly observability (M2 onwards).
 */
export function createLogger(name = "memokit", level?: string): Logger {
  return pino({
    name,
    level: level ?? process.env.MEMOKIT_LOG_LEVEL ?? "info",
  });
}
