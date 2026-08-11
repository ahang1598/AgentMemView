import { homedir } from "node:os";
import { claudeCodeAdapter } from "@agentmemview/proxy/onboard/claude-code";
import { codexAdapter } from "@agentmemview/proxy/onboard/codex";
import { opencodeAdapter } from "@agentmemview/proxy/onboard/opencode";
import type { OnboardAdapter, OnboardConfig } from "@agentmemview/proxy/onboard/types";

/**
 * `agentmemview init` — write agent connection configs (idempotent, with
 * backup/restore). Non-interactive flags keep CI/scripts friendly.
 */

const ADAPTERS: OnboardAdapter[] = [claudeCodeAdapter, codexAdapter, opencodeAdapter];

export interface InitOptions {
  agent?: string;
  restore?: boolean;
  home?: string;
  space?: string;
  proxyUrl?: string;
}

export async function initAction(options: InitOptions = {}): Promise<void> {
  const cfg: OnboardConfig = {
    homeDir: options.home ?? homedir(),
    proxyBaseUrl: options.proxyUrl ?? "http://127.0.0.1:8619",
    spaceId: options.space ?? "default",
  };
  const selected =
    options.agent !== undefined ? ADAPTERS.filter((a) => a.name === options.agent) : ADAPTERS;
  if (selected.length === 0) {
    console.log(
      `unknown agent "${options.agent}"; supported: ${ADAPTERS.map((a) => a.name).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  for (const adapter of selected) {
    if (options.restore === true) {
      adapter.restore(cfg);
      console.log(`[${adapter.name}] restored`);
      continue;
    }
    if (adapter.detect(cfg)) {
      console.log(`[${adapter.name}] already connected`);
      continue;
    }
    const result = adapter.install(cfg);
    console.log(
      `[${adapter.name}] ${result.changed ? "connected" : "skipped"}${
        result.note !== undefined ? ` (${result.note})` : ""
      }`,
    );
  }
}
