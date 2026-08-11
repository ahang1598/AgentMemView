#!/usr/bin/env node
// agentmemview-mcp: stdio JSON-RPC transport (line-delimited JSON).
import { createInterface } from "node:readline";
import { createAgentMemViewMcp } from "../dist/index.js";

const server = createAgentMemViewMcp({
  coreBaseUrl: process.env.AGENTMEMVIEW_CORE_URL ?? "http://127.0.0.1:8620",
  ...(process.env.AGENTMEMVIEW_SPACE !== undefined
    ? { defaultSpace: process.env.AGENTMEMVIEW_SPACE }
    : {}),
});

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
    );
    return;
  }
  void server.handle(request).then((response) => {
    if (response !== undefined) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });
});
