import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backupBeforeChange,
  ensureDir,
  markCreated,
  readJsonOrDefault,
  restoreFile,
} from "./files.js";
import type { ClaudeEnvOptions, OnboardAdapter, OnboardConfig, OnboardResult } from "./types.js";

/**
 * Claude Code onboarding: merges proxy env keys into ~/.claude/settings.json.
 * Merge semantics — only the keys we manage are written; every other entry
 * (user's token, model overrides, hooks, …) stays untouched.
 */

function settingsPath(cfg: OnboardConfig): string {
  return path.join(cfg.homeDir, ".claude", "settings.json");
}

function targetUrl(cfg: OnboardConfig): string {
  return `${cfg.proxyBaseUrl}/claude-code/${cfg.spaceId}`;
}

function serialize(settings: Record<string, unknown>): string {
  return JSON.stringify(settings, null, 2);
}

/** The exact env keys this adapter manages; undefined options are skipped. */
function envOverrides(cfg: OnboardConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ANTHROPIC_BASE_URL: targetUrl(cfg) };
  const ce: ClaudeEnvOptions | undefined = cfg.claudeEnv;
  if (ce !== undefined) {
    if (ce.authToken !== undefined) {
      out.ANTHROPIC_AUTH_TOKEN = ce.authToken;
    }
    if (ce.defaultHaikuModel !== undefined) {
      out.ANTHROPIC_DEFAULT_HAIKU_MODEL = ce.defaultHaikuModel;
    }
    if (ce.defaultSonnetModel !== undefined) {
      out.ANTHROPIC_DEFAULT_SONNET_MODEL = ce.defaultSonnetModel;
    }
    if (ce.defaultOpusModel !== undefined) {
      out.ANTHROPIC_DEFAULT_OPUS_MODEL = ce.defaultOpusModel;
    }
    if (ce.autoCompactWindow !== undefined) {
      out.CLAUDE_CODE_AUTO_COMPACT_WINDOW = ce.autoCompactWindow;
    }
    if (ce.disableNonessentialTraffic === true) {
      // numeric 1, matching Claude Code's expected shape
      out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1;
    }
    if (ce.apiTimeoutMs !== undefined) {
      out.API_TIMEOUT_MS = ce.apiTimeoutMs;
    }
  }
  return out;
}

export const claudeCodeAdapter: OnboardAdapter = {
  name: "claude-code",

  detect(cfg: OnboardConfig): boolean {
    const settings = readJsonOrDefault(settingsPath(cfg));
    const env = settings.env as Record<string, unknown> | undefined;
    return env?.ANTHROPIC_BASE_URL === targetUrl(cfg);
  },

  install(cfg: OnboardConfig): OnboardResult {
    const file = settingsPath(cfg);
    const settings = readJsonOrDefault(file);
    const env = (settings.env ?? {}) as Record<string, unknown>;
    const existing = env.ANTHROPIC_BASE_URL;
    const url = targetUrl(cfg);
    const overrides = envOverrides(cfg);
    if (typeof existing === "string" && existing !== url) {
      if (cfg.force !== true) {
        return {
          changed: false,
          note: `conflict: ANTHROPIC_BASE_URL already set to ${existing}; re-run with force to replace it (backup kept, restore reverts), or set the proxy upstream to that URL`,
        };
      }
      // force: backup happens below (backupBeforeChange) before overwrite
    }
    // idempotent only when every managed key already matches (merge semantics)
    const allMatch = Object.entries(overrides).every(([key, value]) => env[key] === value);
    if (allMatch) {
      return { changed: false, note: "already configured" };
    }
    // merge: keep all unrelated env entries byte-identical
    const next: Record<string, unknown> = { ...settings, env: { ...env, ...overrides } };
    const nextContent = serialize(next);
    if (existsSync(file) && readFileSync(file, "utf8") === nextContent) {
      return { changed: false, note: "already configured" };
    }
    ensureDir(file);
    backupBeforeChange(file);
    if (!existsSync(file)) {
      markCreated(file);
    }
    writeFileSync(file, nextContent, "utf8");
    const replacedNote =
      typeof existing === "string" && existing !== url ? ` (replaced ${existing})` : "";
    const keysNote =
      Object.keys(overrides).length > 1 ? ` +${Object.keys(overrides).length - 1} keys` : "";
    return { changed: true, note: `ANTHROPIC_BASE_URL -> ${url}${keysNote}${replacedNote}` };
  },

  restore(cfg: OnboardConfig): void {
    restoreFile(settingsPath(cfg));
  },
};
