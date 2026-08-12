#!/usr/bin/env node
// agentmemview-proxy: standalone transparent proxy launcher.
// Env: AGENTMEMVIEW_CORE_URL, AGENTMEMVIEW_UPSTREAM_ANTHROPIC,
//      AGENTMEMVIEW_UPSTREAM_OPENAI, AGENTMEMVIEW_ACCESS_KEY,
//      AGENTMEMVIEW_PROXY_PORT / AGENTMEMVIEW_PROXY_HOST
import { startProxyServer } from "../dist/server.js";

const port = Number(process.env.AGENTMEMVIEW_PROXY_PORT ?? 8619);
const host = process.env.AGENTMEMVIEW_PROXY_HOST ?? "127.0.0.1";
const coreBaseUrl = process.env.AGENTMEMVIEW_CORE_URL ?? "http://127.0.0.1:8620";

const options = {
  coreBaseUrl,
  port,
  host,
  ...(process.env.AGENTMEMVIEW_ACCESS_KEY !== undefined
    ? { accessKey: process.env.AGENTMEMVIEW_ACCESS_KEY }
    : {}),
  ...(process.env.AGENTMEMVIEW_UPSTREAM_ANTHROPIC !== undefined
    ? { upstreamAnthropic: process.env.AGENTMEMVIEW_UPSTREAM_ANTHROPIC }
    : {}),
  ...(process.env.AGENTMEMVIEW_UPSTREAM_OPENAI !== undefined
    ? { upstreamOpenai: process.env.AGENTMEMVIEW_UPSTREAM_OPENAI }
    : {}),
};

const run = async () => {
  const running = await startProxyServer(options);
  console.log(`agentmemview proxy listening on http://${host}:${running.port}`);
  console.log(`  anthropic upstream -> ${running.upstreams.anthropic}`);
  console.log(`  openai upstream    -> ${running.upstreams.openai}`);
  console.log(`  core               -> ${coreBaseUrl}`);
  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
