import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backupBeforeChange,
  ensureDir,
  markCreated,
  readJsonOrDefault,
  restoreFile,
} from "./files.js";
import type { OnboardAdapter, OnboardConfig, OnboardResult } from "./types.js";

/**
 * Claude Code onboarding: ANTHROPIC_BASE_URL in ~/.claude/settings.json env.
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
    if (typeof existing === "string" && existing !== url) {
      if (cfg.force !== true) {
        return {
          changed: false,
          note: `conflict: ANTHROPIC_BASE_URL already set to ${existing}; re-run with --force to replace it (backup kept, --restore reverts), or set the proxy upstream to that URL`,
        };
      }
      // force: backup happens below (backupBeforeChange) before overwrite
    }
    if (existing === url) {
      return { changed: false, note: "already configured" };
    }
    const next: Record<string, unknown> = { ...settings, env: { ...env, ANTHROPIC_BASE_URL: url } };
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
    return { changed: true, note: `ANTHROPIC_BASE_URL -> ${url}${replacedNote}` };
  },

  restore(cfg: OnboardConfig): void {
    restoreFile(settingsPath(cfg));
  },
};
