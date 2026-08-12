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

  it("claude-code merges env keys without touching unrelated entries", () => {
    const home = makeHome();
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "keep-me",
          SOME_OTHER_VAR: "untouched",
        },
        hooks: { PreToolUse: [{ matcher: "Bash" }] },
      }),
      "utf8",
    );
    const result = claudeCodeAdapter.install({
      ...cfg(home),
      claudeEnv: {
        defaultHaikuModel: "glm-5.2[1m]",
        defaultSonnetModel: "glm-5.2[1m]",
        defaultOpusModel: "glm-5.2[1m]",
        autoCompactWindow: "1000000",
        disableNonessentialTraffic: true,
        apiTimeoutMs: "3000000",
      },
    });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      env: Record<string, unknown>;
      hooks: unknown;
    };
    // managed keys written
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8619/claude-code/default");
    expect(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.2[1m]");
    expect(parsed.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("1000000");
    expect(parsed.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe(1); // numeric, not string
    expect(parsed.env.API_TIMEOUT_MS).toBe("3000000");
    // unrelated entries untouched
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe("keep-me");
    expect(parsed.env.SOME_OTHER_VAR).toBe("untouched");
    expect(parsed.hooks).toEqual({ PreToolUse: [{ matcher: "Bash" }] });
    // idempotent: second run with same overrides changes nothing
    const second = claudeCodeAdapter.install({
      ...cfg(home),
      claudeEnv: {
        defaultHaikuModel: "glm-5.2[1m]",
        defaultSonnetModel: "glm-5.2[1m]",
        defaultOpusModel: "glm-5.2[1m]",
        autoCompactWindow: "1000000",
        disableNonessentialTraffic: true,
        apiTimeoutMs: "3000000",
      },
    });
    expect(second.changed).toBe(false);
  });

  it("claude-code updates managed keys later without clobbering others", () => {
    const home = makeHome();
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "tok" } }), "utf8");
    claudeCodeAdapter.install(cfg(home));
    // later apply adds a model override; token must survive
    claudeCodeAdapter.install({ ...cfg(home), claudeEnv: { defaultOpusModel: "glm-5.2[1m]" } });
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      env: Record<string, unknown>;
    };
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe("tok");
    expect(parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.2[1m]");
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8619/claude-code/default");
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
