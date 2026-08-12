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

/** OpenCode onboarding: provider entry in ~/.config/opencode/opencode.json. */

function configPath(cfg: OnboardConfig): string {
  return path.join(cfg.homeDir, ".config", "opencode", "opencode.json");
}

function targetUrl(cfg: OnboardConfig): string {
  return `${cfg.proxyBaseUrl}/opencode/${cfg.spaceId}`;
}

export const opencodeAdapter: OnboardAdapter = {
  name: "opencode",

  detect(cfg: OnboardConfig): boolean {
    const settings = readJsonOrDefault(configPath(cfg));
    const providers = settings.providers as Record<string, unknown> | undefined;
    const ours = providers?.agentmemview as Record<string, unknown> | undefined;
    return ours?.baseUrl === targetUrl(cfg);
  },

  install(cfg: OnboardConfig): OnboardResult {
    const file = configPath(cfg);
    const settings = readJsonOrDefault(file);
    const providers = (settings.providers ?? {}) as Record<string, unknown>;
    const ours = (providers.agentmemview ?? {}) as Record<string, unknown>;
    if (ours.baseUrl === targetUrl(cfg)) {
      return { changed: false, note: "already configured" };
    }
    const next: Record<string, unknown> = {
      ...settings,
      providers: {
        ...providers,
        agentmemview: { ...ours, baseUrl: targetUrl(cfg) },
      },
    };
    const nextContent = JSON.stringify(next, null, 2);
    if (existsSync(file) && readFileSync(file, "utf8") === nextContent) {
      return { changed: false, note: "already configured" };
    }
    ensureDir(file);
    backupBeforeChange(file);
    if (!existsSync(file)) {
      markCreated(file);
    }
    writeFileSync(file, nextContent, "utf8");
    return { changed: true, note: `providers.agentmemview.baseUrl -> ${targetUrl(cfg)}` };
  },

  restore(cfg: OnboardConfig): void {
    restoreFile(configPath(cfg));
  },
};
