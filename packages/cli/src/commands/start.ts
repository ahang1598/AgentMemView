import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { migrate, openDatabase, startHttpServer } from "@agentmemview/core";

/**
 * `agentmemview start` (foreground / -d detached) and `agentmemview stop`.
 * Data home defaults to ~/.AgentMemView (db + pid file live there).
 */

export interface StartOptions {
  detach?: boolean;
  foreground?: boolean;
  port?: string;
  host?: string;
  data?: string;
}

export function dataHome(option: string | undefined): string {
  return option ?? path.join(homedir(), ".AgentMemView");
}

function pidFile(home: string): string {
  return path.join(home, "agentmemview.pid");
}

export async function startAction(options: StartOptions): Promise<void> {
  const home = dataHome(options.data);
  mkdirSync(home, { recursive: true });
  const port = Number(options.port ?? process.env.AGENTMEMVIEW_PORT ?? 8620);
  const host = options.host ?? process.env.AGENTMEMVIEW_HOST ?? "127.0.0.1";

  if (options.detach === true && options.foreground !== true) {
    const child = spawn(
      process.execPath,
      [
        ...process.argv.slice(1, 2),
        "start",
        "--foreground",
        "--port",
        String(port),
        "--host",
        host,
        "--data",
        home,
      ],
      {
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.unref();
    writeFileSync(pidFile(home), String(child.pid ?? ""), "utf8");
    console.log(
      `agentmemview starting in background (pid ${child.pid ?? "?"}) on http://${host}:${port}`,
    );
    return;
  }

  const db = openDatabase(path.join(home, "agentmemview.db"));
  migrate(db);
  const server = await startHttpServer(db, { port, host });
  writeFileSync(pidFile(home), String(process.pid), "utf8");
  console.log(`agentmemview core listening on http://${host}:${server.port}`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    db.close();
    try {
      unlinkSync(pidFile(home));
    } catch {
      // already removed
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

export async function stopAction(options: { data?: string } = {}): Promise<void> {
  const home = dataHome(options.data);
  const file = pidFile(home);
  if (!existsSync(file)) {
    console.log("agentmemview is not running (no pid file)");
    return;
  }
  const pid = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
  if (Number.isNaN(pid)) {
    unlinkSync(file);
    console.log("removed invalid pid file");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`sent SIGTERM to agentmemview (pid ${pid})`);
  } catch (err) {
    console.log(`process ${pid} not running (${(err as Error).message})`);
  }
  unlinkSync(file);
}
