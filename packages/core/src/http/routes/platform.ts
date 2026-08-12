import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { buildCapabilities } from "../../capabilities/registry.js";
import { JobQueue } from "../../jobs/queue.js";
import { claudeCodeAdapter } from "../../onboard/claude-code.js";
import { codexAdapter } from "../../onboard/codex.js";
import { opencodeAdapter } from "../../onboard/opencode.js";
import type { OnboardAdapter, OnboardConfig } from "../../onboard/types.js";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/**
 * Capability center + runtime config + jobs + onboarding detection/apply
 * (M3-11/12, M4-09). Capability state machine: off / error / active.
 */

const ONBOARD_ADAPTERS: OnboardAdapter[] = [claudeCodeAdapter, codexAdapter, opencodeAdapter];

const onboardApplyBody = z.object({
  agent: z.string().min(1),
  proxyBaseUrl: z.string().url().default("http://127.0.0.1:8619"),
  spaceId: z.string().min(1).default("default"),
  force: z.boolean().optional(),
  restore: z.boolean().optional(),
});

export const platformRoutes = new Hono<HttpEnv>()
  .get("/capabilities", async (c) => {
    const db = c.get("db");
    const items = await buildCapabilities(db);
    return c.json({ items });
  })
  .get("/jobs", (c) => {
    const db = c.get("db");
    const queue = new JobQueue(db);
    const items = queue.list();
    const dlq = db.prepare("SELECT COUNT(*) AS n FROM jobs_dlq").get() as { n: number };
    return c.json({ items, deadLetters: dlq.n });
  })
  .get("/config", (c) => {
    const db = c.get("db");
    const rows = db.prepare("SELECT key, value_json FROM config").all() as Array<{
      key: string;
      value_json: string;
    }>;
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value_json);
      } catch {
        out[row.key] = row.value_json;
      }
    }
    return c.json(out);
  })
  .put("/config", validate("json", z.record(z.string(), z.unknown())), (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");
    const upsert = db.prepare("INSERT OR REPLACE INTO config (key, value_json) VALUES (?, ?)");
    for (const [key, value] of Object.entries(body)) {
      upsert.run(key, JSON.stringify(value));
    }
    try {
      c.get("bus").publish("config.updated", { keys: Object.keys(body) });
    } catch {
      // hot-reload notification is best-effort
    }
    return c.json(body);
  })
  .get("/onboard/status", (c) => {
    const home = process.env.AGENTMEMVIEW_HOME ?? homedir();
    const checks = [
      { agent: "claude-code", file: path.join(home, ".claude", "settings.json") },
      { agent: "codex", file: path.join(home, ".codex", "config.toml") },
      {
        agent: "opencode",
        file: path.join(home, ".config", "opencode", "opencode.json"),
      },
    ];
    return c.json({
      items: checks.map((check) => ({
        agent: check.agent,
        detected: existsSync(check.file),
        note: existsSync(check.file) ? `检测到 ${check.file}` : `未找到 ${check.file}`,
      })),
    });
  })
  .post("/onboard/apply", validate("json", onboardApplyBody), (c) => {
    // Same adapters as `agentmemview init`, exposed for the Dashboard settings
    // page so users can wire an agent to the proxy without a terminal.
    const body = c.req.valid("json");
    const adapter = ONBOARD_ADAPTERS.find((a) => a.name === body.agent);
    if (adapter === undefined) {
      return c.json(
        {
          error: "validation",
          message: `unknown agent "${body.agent}"; supported: ${ONBOARD_ADAPTERS.map((a) => a.name).join(", ")}`,
        },
        400,
      );
    }
    const cfg: OnboardConfig = {
      homeDir: process.env.AGENTMEMVIEW_HOME ?? homedir(),
      proxyBaseUrl: body.proxyBaseUrl,
      spaceId: body.spaceId,
      ...(body.force === true ? { force: true } : {}),
    };
    if (body.restore === true) {
      adapter.restore(cfg);
      return c.json({ agent: body.agent, restored: true });
    }
    const result = adapter.install(cfg);
    return c.json({
      agent: body.agent,
      changed: result.changed,
      ...(result.note !== undefined ? { note: result.note } : {}),
    });
  });
