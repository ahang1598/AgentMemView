import { existsSync, type FSWatcher, readFileSync, watch } from "node:fs";
import { parse } from "yaml";
import { type AgentMemViewConfig, configSchema } from "./schema.js";

/** Thrown when the config file cannot be parsed or fails schema validation. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface LoadConfigResult {
  config: AgentMemViewConfig;
  warnings: string[];
}

export type ConfigChangeHandler = (config: AgentMemViewConfig) => void;

const WATCH_DEBOUNCE_MS = 200;

/**
 * Load and validate `agentmemview.config.yaml`.
 * - Missing file: returns full defaults plus a warning.
 * - Invalid YAML or schema violation: throws ConfigError with field paths.
 */
export function loadConfig(path: string): LoadConfigResult {
  if (!existsSync(path)) {
    return {
      config: configSchema.parse({}),
      warnings: [`config file not found at ${path}; using built-in defaults`],
    };
  }

  let data: unknown;
  try {
    data = parse(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    throw new ConfigError(`failed to parse YAML at ${path}: ${(err as Error).message}`);
  }

  const result = configSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`invalid config at ${path}: ${details}`);
  }
  return { config: result.data, warnings: [] };
}

/**
 * Watch the config file and invoke `onChange` with a fresh (immutable) config
 * object whenever the file changes. Changes are debounced by 200ms. Invalid
 * rewrites keep the previous config and are reported via `onError` if given.
 * Returns an unsubscribe function.
 */
export function watchConfig(
  path: string,
  onChange: ConfigChangeHandler,
  onError?: (err: Error) => void,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(path, () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        try {
          onChange(loadConfig(path).config);
        } catch (err) {
          if (onError) {
            onError(err as Error);
          }
        }
      }, WATCH_DEBOUNCE_MS);
    });
  } catch (err) {
    if (onError) {
      onError(err as Error);
    }
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    watcher?.close();
  };
}
