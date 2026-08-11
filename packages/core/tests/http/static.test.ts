import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { staticFileResponse } from "../../src/http/static.js";

const tempDirs: string[] = [];

function makeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-static-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(path.join(dir, "index.html"), "<html>app-shell</html>", "utf8");
  writeFileSync(path.join(dir, "assets", "app.abc123.js"), "console.log(1)", "utf8");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("static hosting (M3-14)", () => {
  it("GET / serves index.html", async () => {
    const dir = makeDist();
    const res = staticFileResponse(dir, "/");
    expect(res).toBeDefined();
    expect(await res?.text()).toContain("app-shell");
  });

  it("SPA fallback: /memories serves index.html", async () => {
    const dir = makeDist();
    const res = staticFileResponse(dir, "/memories");
    expect(res).toBeDefined();
    expect(await res?.text()).toContain("app-shell");
    expect(res?.headers.get("content-type")).toContain("text/html");
  });

  it("hashed assets get immutable cache headers", async () => {
    const dir = makeDist();
    const res = staticFileResponse(dir, "/assets/app.abc123.js");
    expect(res).toBeDefined();
    expect(res?.headers.get("cache-control")).toContain("immutable");
    expect(await res?.text()).toBe("console.log(1)");
  });

  it("api paths are never shadowed", () => {
    const dir = makeDist();
    expect(staticFileResponse(dir, "/api/v1/health")).toBeUndefined();
  });

  it("missing files with extensions return undefined", () => {
    const dir = makeDist();
    expect(staticFileResponse(dir, "/nope.js")).toBeUndefined();
  });
});
