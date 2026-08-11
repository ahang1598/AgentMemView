import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "@agentmemview/core";

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorChecks {
  node: CheckResult;
  platform: CheckResult;
  portProxy: CheckResult;
  portCore: CheckResult;
  sqliteVec: CheckResult;
  writable: CheckResult;
}

export interface DoctorReport {
  checks: DoctorChecks;
  ok: boolean;
}

export interface DoctorOptions {
  nodeVersion?: string;
  proxyPort?: number;
  corePort?: number;
  dataDir?: string;
}

const DEFAULT_PROXY_PORT = 8619;
const DEFAULT_CORE_PORT = 8620;
const EMBEDDING_DIMS = 384;

function checkNode(nodeVersion: string): CheckResult {
  const match = /^v?(\d+)\./.exec(nodeVersion);
  const major = match?.[1] ? Number(match[1]) : Number.NaN;
  if (Number.isNaN(major)) {
    return { status: "fail", detail: `unparseable node version "${nodeVersion}"` };
  }
  if (major >= 22) {
    return { status: "ok", detail: nodeVersion };
  }
  if (major >= 20) {
    return {
      status: "warn",
      detail: nodeVersion,
      hint: "Node 22 LTS is the supported baseline; upgrade before production use",
    };
  }
  return { status: "fail", detail: nodeVersion, hint: "install Node 22 LTS or newer" };
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function checkPort(label: string, port: number): Promise<CheckResult> {
  const free = await isPortFree(port);
  if (free) {
    return { status: "ok", detail: `${label} port ${port} is free` };
  }
  return {
    status: "fail",
    detail: `${label} port ${port} is already in use`,
    hint: `change the port in agentmemview.config.yaml or stop the process holding port ${port}`,
  };
}

function checkSqliteVec(): CheckResult {
  let probeDir: string | undefined;
  try {
    probeDir = mkdtempSync(path.join(tmpdir(), "agentmemview-doctor-vec-"));
    const db = openDatabase(path.join(probeDir, "probe.db"));
    try {
      const a = new Float32Array(EMBEDDING_DIMS);
      a[0] = 1;
      const b = new Float32Array(EMBEDDING_DIMS);
      b[0] = 1;
      const row = db
        .prepare("SELECT vec_distance_cosine(vec_f32(?), vec_f32(?)) AS dist")
        .get(Buffer.from(a.buffer), Buffer.from(b.buffer)) as { dist: number };
      if (!Number.isFinite(row.dist)) {
        return { status: "fail", detail: "vec_distance_cosine returned a non-finite value" };
      }
      return { status: "ok", detail: "sqlite-vec loaded and computed" };
    } finally {
      db.close();
    }
  } catch (err) {
    return {
      status: "fail",
      detail: (err as Error).message,
      hint: "sqlite-vec native binary failed to load; reinstall dependencies (prebuilt binaries required on Windows)",
    };
  } finally {
    if (probeDir) {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }
}

function checkWritable(dataDir: string): CheckResult {
  try {
    mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, ".agentmemview-write-probe");
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    return { status: "ok", detail: dataDir };
  } catch (err) {
    return {
      status: "fail",
      detail: (err as Error).message,
      hint: "pick a writable storage.dataDir in agentmemview.config.yaml",
    };
  }
}

/** Run all environment checks and assemble the doctor report. */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const proxyPort = options.proxyPort ?? DEFAULT_PROXY_PORT;
  const corePort = options.corePort ?? DEFAULT_CORE_PORT;
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");

  const checks: DoctorChecks = {
    node: checkNode(options.nodeVersion ?? process.version),
    platform: { status: "ok", detail: `${process.platform} (${process.arch})` },
    portProxy: await checkPort("proxy", proxyPort),
    portCore: await checkPort("core", corePort),
    sqliteVec: checkSqliteVec(),
    writable: checkWritable(dataDir),
  };

  const ok = Object.values(checks).every((check) => check.status !== "fail");
  return { checks, ok };
}

function printHuman(report: DoctorReport): void {
  const statusLabel: Record<CheckStatus, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
  console.log("agentmemview doctor");
  console.log("--------------");
  for (const [name, check] of Object.entries(report.checks) as Array<[string, CheckResult]>) {
    console.log(`[${statusLabel[check.status]}] ${name}: ${check.detail}`);
    if (check.hint) {
      console.log(`       hint: ${check.hint}`);
    }
  }
  console.log(`result: ${report.ok ? "healthy" : "problems found"}`);
}

/** Commander action for `agentmemview doctor [--json]`. */
export async function doctorAction(options: { json?: boolean }): Promise<void> {
  const report = await runDoctor();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exitCode = report.ok ? 0 : 1;
}
