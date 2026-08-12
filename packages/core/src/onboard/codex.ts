import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backupBeforeChange, ensureDir, markCreated, restoreFile } from "./files.js";
import type { OnboardAdapter, OnboardConfig, OnboardResult } from "./types.js";

/**
 * Codex onboarding: append/patch an agentmemview model provider block in
 * ~/.codex/config.toml while preserving all user content (line-based edit,
 * no TOML dependency).
 */

function configPath(cfg: OnboardConfig): string {
  return path.join(cfg.homeDir, ".codex", "config.toml");
}

function targetUrl(cfg: OnboardConfig): string {
  return `${cfg.proxyBaseUrl}/codex/${cfg.spaceId}`;
}

function providerBlock(cfg: OnboardConfig): string {
  return [
    "[model_providers.agentmemview]",
    'name = "AgentMemView"',
    `base_url = "${targetUrl(cfg)}"`,
    'wire_api = "chat"',
  ].join("\n");
}

export const codexAdapter: OnboardAdapter = {
  name: "codex",

  detect(cfg: OnboardConfig): boolean {
    const file = configPath(cfg);
    if (!existsSync(file)) {
      return false;
    }
    return readFileSync(file, "utf8").includes(`base_url = "${targetUrl(cfg)}"`);
  },

  install(cfg: OnboardConfig): OnboardResult {
    const file = configPath(cfg);
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    const baseUrlLine = `base_url = "${targetUrl(cfg)}"`;
    if (existing.includes(baseUrlLine)) {
      return { changed: false, note: "already configured" };
    }
    ensureDir(file);
    backupBeforeChange(file);
    if (!existsSync(file)) {
      markCreated(file);
    }
    let next: string;
    if (existing.includes("[model_providers.agentmemview]")) {
      // patch the base_url line inside the existing section
      next = existing.replace(
        /(\[model_providers\.agentmemview\][\s\S]*?base_url = ")[^"]*(")/,
        `$1${targetUrl(cfg)}$2`,
      );
      if (next === existing) {
        // section exists but no base_url line: append it after the header
        next = existing.replace(
          "[model_providers.agentmemview]",
          `[model_providers.agentmemview]\n${baseUrlLine}`,
        );
      }
    } else {
      const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      next = `${existing}${separator}\n${providerBlock(cfg)}\n`;
    }
    writeFileSync(file, next, "utf8");
    return { changed: true, note: `base_url -> ${targetUrl(cfg)}` };
  },

  restore(cfg: OnboardConfig): void {
    restoreFile(configPath(cfg));
  },
};
