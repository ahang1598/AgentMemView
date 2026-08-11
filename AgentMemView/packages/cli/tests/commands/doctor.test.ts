import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../src/commands/doctor.js";
import { createCli } from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-doctor-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("doctor", () => {
  it("reports node version ok for >=22 and warn below", async () => {
    const okReport = await runDoctor({ nodeVersion: "v22.1.0", dataDir: makeTempDir() });
    expect(okReport.checks.node.status).toBe("ok");

    const warnReport = await runDoctor({ nodeVersion: "v20.11.0", dataDir: makeTempDir() });
    expect(warnReport.checks.node.status).toBe("warn");
  });

  it("reports sqlite-vec loadable", async () => {
    const report = await runDoctor({ dataDir: makeTempDir() });
    expect(report.checks.sqliteVec.status).toBe("ok");
  });

  it("reports port availability (occupied proxy port fails with hint)", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => {
      blocker.listen({ port: 0, host: "127.0.0.1" }, () => resolve());
    });
    const address = blocker.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const report = await runDoctor({
        proxyPort: port,
        corePort: port,
        dataDir: makeTempDir(),
      });
      expect(report.checks.portProxy.status).toBe("fail");
      expect(report.checks.portProxy.hint).toContain("port");
      expect(report.checks.portCore.status).toBe("fail");
      expect(report.ok).toBe(false);
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    }
  });

  it("output is valid json with --json", async () => {
    const dir = makeTempDir();
    const originalCwd = process.cwd();
    process.chdir(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = createCli();
      program.exitOverride();
      await program.parseAsync(["node", "agentmemview", "doctor", "--json"]);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      const parsed = JSON.parse(output) as { checks: Record<string, unknown> };
      expect(parsed.checks).toBeDefined();
      expect(Object.keys(parsed.checks).sort()).toEqual([
        "node",
        "platform",
        "portCore",
        "portProxy",
        "sqliteVec",
        "writable",
      ]);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
