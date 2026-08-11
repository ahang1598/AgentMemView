import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig, watchConfig } from "../../src/config/loader.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memokit-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("loads valid yaml -> typed config with defaults filled", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "memokit.config.yaml");
    // Minimal yaml: only override one field, everything else must come from defaults.
    writeFileSync(file, "server:\n  port: 9000\n", "utf8");

    const { config, warnings } = loadConfig(file);

    expect(config.server.port).toBe(9000);
    expect(config.proxy.port).toBe(8619);
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.decay.halfLifeDays).toBe(30);
    expect(config.embedding.provider).toBe("local");
    expect(warnings).toEqual([]);
  });

  it("rejects invalid port with field path in error", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "memokit.config.yaml");
    writeFileSync(file, "proxy:\n  port: 99999\n", "utf8");

    expect(() => loadConfig(file)).toThrow(ConfigError);
    try {
      loadConfig(file);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("proxy.port");
    }
  });

  it("missing file -> defaults + warnings", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "does-not-exist.yaml");

    const { config, warnings } = loadConfig(file);

    expect(config.server.port).toBe(8620);
    expect(config.proxy.port).toBe(8619);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("watchConfig", () => {
  it("hot reload emits change with immutable update", async () => {
    const dir = makeTempDir();
    const file = path.join(dir, "memokit.config.yaml");
    writeFileSync(file, "server:\n  port: 9000\n", "utf8");

    const initial = loadConfig(file).config;
    const received: unknown[] = [];
    const unsubscribe = watchConfig(file, (next) => {
      received.push(next);
    });

    try {
      // Give the watcher time to attach, then modify the file.
      await new Promise((resolve) => setTimeout(resolve, 100));
      writeFileSync(file, "server:\n  port: 9100\n", "utf8");

      await vi.waitFor(
        () => {
          expect(received.length).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 50 },
      );

      const next = received.at(-1) as typeof initial;
      expect(next.server.port).toBe(9100);
      // Old reference must not be mutated (immutable update).
      expect(initial.server.port).toBe(9000);
      expect(next).not.toBe(initial);
    } finally {
      unsubscribe();
    }
  });
});
