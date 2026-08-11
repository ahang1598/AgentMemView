import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("release readiness (M5-08)", () => {
  it("version trio consistent: cli/core/proxy package versions match root", () => {
    const readVersion = (rel: string): string =>
      (JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8")) as { version: string }).version;
    const cli = readVersion("packages/cli/package.json");
    const core = readVersion("packages/core/package.json");
    const proxy = readVersion("packages/proxy/package.json");
    expect(cli).toBe(core);
    expect(proxy).toBe(core);
  });

  it("published package file lists exclude tests and fixtures", () => {
    for (const pkg of ["core", "cli", "proxy", "mcp", "eval"]) {
      const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, `packages/${pkg}/package.json`), "utf8"),
      ) as { files?: string[] };
      const files = manifest.files ?? [];
      for (const entry of files) {
        expect(entry).not.toContain("tests");
        expect(entry).not.toContain("fixtures");
      }
    }
  });

  it("release workflow exists and is tag-triggered", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain("v*");
    expect(workflow).toContain("pnpm test");
  });
});
