import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { claudeCodeAdapter } from "@agentmemview/proxy/onboard/claude-code";
import { codexAdapter } from "@agentmemview/proxy/onboard/codex";
import { opencodeAdapter } from "@agentmemview/proxy/onboard/opencode";
import type { OnboardConfig } from "@agentmemview/proxy/onboard/types";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-onboard-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function cfg(home: string): OnboardConfig {
  return { homeDir: home, proxyBaseUrl: "http://127.0.0.1:8619", spaceId: "default" };
}

describe("onboard adapters (M2-09)", () => {
  it("claude-code adapter writes settings.json env keys idempotently", () => {
    const home = makeHome();
    const adapter = claudeCodeAdapter;
    expect(adapter.detect(cfg(home))).toBe(false);
    adapter.install(cfg(home));
    const settingsPath = path.join(home, ".claude", "settings.json");
    const first = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(first) as { env: Record<string, string> };
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8619/claude-code/default");
    expect(adapter.detect(cfg(home))).toBe(true);
    // idempotent: second install does not duplicate or rewrite
    adapter.install(cfg(home));
    expect(readFileSync(settingsPath, "utf8")).toBe(first);
  });

  it("claude-code refuses to overwrite a conflicting existing base url", () => {
    const home = makeHome();
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://other-gateway.example" } }),
      "utf8",
    );
    const result = claudeCodeAdapter.install(cfg(home));
    expect(result.changed).toBe(false);
    expect(result.note).toContain("conflict");
  });

  it("claude-code --force replaces a conflicting base url (backup kept)", () => {
    const home = makeHome();
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic" } }),
      "utf8",
    );
    const result = claudeCodeAdapter.install({ ...cfg(home), force: true });
    expect(result.changed).toBe(true);
    expect(result.note).toContain("replaced https://open.bigmodel.cn/api/anthropic");
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).toContain("http://127.0.0.1:8619/claude-code/default");
    // restore reverts to the original gateway url
    claudeCodeAdapter.restore(cfg(home));
    const restored = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(JSON.stringify(restored)).toContain("open.bigmodel.cn");
  });

  it("codex adapter edits config.toml preserving user content", () => {
    const home = makeHome();
    const tomlDir = path.join(home, ".codex");
    mkdirSync(tomlDir, { recursive: true });
    const existing = '# user notes\nmodel = "gpt-5-codex"\n[features]\nother = true\n';
    writeFileSync(path.join(tomlDir, "config.toml"), existing, "utf8");
    codexAdapter.install(cfg(home));
    const updated = readFileSync(path.join(tomlDir, "config.toml"), "utf8");
    expect(updated).toContain('model = "gpt-5-codex"');
    expect(updated).toContain("[features]");
    expect(updated).toContain('base_url = "http://127.0.0.1:8619/codex/default"');
  });

  it("opencode adapter writes json", () => {
    const home = makeHome();
    opencodeAdapter.install(cfg(home));
    const file = path.join(home, ".config", "opencode", "opencode.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).toContain("http://127.0.0.1:8619/opencode/default");
  });

  it("install backs up and restore reverts all changes", () => {
    const home = makeHome();
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    const original = JSON.stringify({ env: { OTHER: "keep" } });
    writeFileSync(settingsPath, original, "utf8");

    claudeCodeAdapter.install(cfg(home));
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).env.ANTHROPIC_BASE_URL).toContain("8619");

    claudeCodeAdapter.restore(cfg(home));
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    // restore is idempotent
    claudeCodeAdapter.restore(cfg(home));
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  it("restore removes files created by install when nothing existed before", () => {
    const home = makeHome();
    opencodeAdapter.install(cfg(home));
    const file = path.join(home, ".config", "opencode", "opencode.json");
    expect(existsSync(file)).toBe(true);
    opencodeAdapter.restore(cfg(home));
    expect(existsSync(file)).toBe(false);
  });
});
