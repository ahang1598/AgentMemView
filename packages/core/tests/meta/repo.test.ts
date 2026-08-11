import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Resolve a runnable pnpm binary across user-level installs and PATH. */
function pnpmCommand(): { cmd: string; shell: boolean } {
  const candidates = [
    path.join(homedir(), ".local", "bin", "pnpm.cmd"),
    path.join(homedir(), ".local", "bin", "pnpm"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // .cmd shims need a shell on Windows
      return { cmd: candidate, shell: candidate.endsWith(".cmd") };
    }
  }
  return { cmd: "pnpm", shell: true };
}

describe("workspace packages resolve", () => {
  it("@agentmemview/core and @agentmemview/cli resolve via pnpm ls", () => {
    // Note: plan specified `pnpm ls --depth -1`; `-r` required to list workspace packages.
    const { cmd, shell } = pnpmCommand();
    const out = execFileSync(cmd, ["ls", "-r", "--depth", "-1", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell,
    });
    expect(out).toContain("@agentmemview/core");
    expect(out).toContain("@agentmemview/cli");
  });
});
