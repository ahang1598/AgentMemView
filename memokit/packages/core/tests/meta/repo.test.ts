import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("workspace packages resolve", () => {
  it("@memokit/core and @memokit/cli resolve via pnpm ls", () => {
    // Note: plan specified `pnpm ls --depth -1`; `-r` required to list workspace packages.
    const out = execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: true,
    });
    expect(out).toContain("@memokit/core");
    expect(out).toContain("@memokit/cli");
  });
});
