import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { startProxyServer } from "@agentmemview/proxy";

/**
 * `agentmemview proxy start/stop` — the transparent proxy on :8619.
 * Upstream resolution: --anthropic-upstream/--openai-upstream flags >
 * AGENTMEMVIEW_UPSTREAM_ANTHROPIC/AGENTMEMVIEW_UPSTREAM_OPENAI env >
 * ANTHROPIC_BASE_URL/OPENAI_BASE_URL (unless they point at this proxy) >
 * api.anthropic.com/api.openai.com. API keys stay with the agent client.
 */

export interface ProxyStartOptions {
  port?: string;
  host?: string;
  core?: string;
  anthropicUpstream?: string;
  openaiUpstream?: string;
  accessKey?: string;
  detach?: boolean;
  foreground?: boolean;
}

function proxyHome(): string {
  return path.join(homedir(), ".AgentMemView");
}

function proxyPidFile(): string {
  return path.join(proxyHome(), "agentmemview-proxy.pid");
}

export async function proxyStartAction(options: ProxyStartOptions = {}): Promise<void> {
  const port = Number(options.port ?? process.env.AGENTMEMVIEW_PROXY_PORT ?? 8619);
  const host = options.host ?? "127.0.0.1";
  const coreBaseUrl = options.core ?? "http://127.0.0.1:8620";

  if (options.detach === true && options.foreground !== true) {
    const args = [
      ...process.argv.slice(1, 2),
      "proxy",
      "start",
      "--foreground",
      "--port",
      String(port),
      "--host",
      host,
      "--core",
      coreBaseUrl,
    ];
    if (options.anthropicUpstream !== undefined) {
      args.push("--anthropic-upstream", options.anthropicUpstream);
    }
    if (options.openaiUpstream !== undefined) {
      args.push("--openai-upstream", options.openaiUpstream);
    }
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    mkdirSync(proxyHome(), { recursive: true });
    writeFileSync(proxyPidFile(), String(child.pid ?? ""), "utf8");
    console.log(
      `agentmemview proxy starting in background (pid ${child.pid ?? "?"}) on http://${host}:${port}`,
    );
    return;
  }

  const running = await startProxyServer({
    coreBaseUrl,
    port,
    host,
    ...(options.accessKey !== undefined ? { accessKey: options.accessKey } : {}),
    ...(options.anthropicUpstream !== undefined
      ? { upstreamAnthropic: options.anthropicUpstream }
      : {}),
    ...(options.openaiUpstream !== undefined ? { upstreamOpenai: options.openaiUpstream } : {}),
  });
  mkdirSync(proxyHome(), { recursive: true });
  writeFileSync(proxyPidFile(), String(process.pid), "utf8");
  console.log(`agentmemview proxy listening on http://${host}:${running.port}`);
  console.log(`  anthropic upstream -> ${running.upstreams.anthropic}`);
  console.log(`  openai upstream    -> ${running.upstreams.openai}`);
  console.log(`  core               -> ${coreBaseUrl}`);
  const shutdown = async (): Promise<void> => {
    await running.close();
    try {
      unlinkSync(proxyPidFile());
    } catch {
      // already removed
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

export async function proxyStopAction(): Promise<void> {
  const file = proxyPidFile();
  if (!existsSync(file)) {
    console.log("proxy is not running (no pid file)");
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
    console.log(`sent SIGTERM to proxy (pid ${pid})`);
  } catch (err) {
    console.log(`process ${pid} not running (${(err as Error).message})`);
  }
  unlinkSync(file);
}
