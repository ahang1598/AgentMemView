import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { isLocalModelAvailable } from "../../embedding/local.js";
import type { HttpEnv } from "../app.js";
import { validate } from "./validation.js";

/**
 * Capability center + runtime config + onboarding detection (M3-11/12).
 * Capability state machine: off / configured / active / error.
 */

function configGet(db: HttpEnv["Variables"]["db"], key: string): unknown {
  const row = db.prepare("SELECT value_json FROM config WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (row === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(row.value_json);
  } catch {
    return undefined;
  }
}

export const platformRoutes = new Hono<HttpEnv>()
  .get("/capabilities", async (c) => {
    const db = c.get("db");
    const llmConfig = configGet(db, "capability.llm-gateway") as
      | Record<string, unknown>
      | undefined;
    const embedConfig = configGet(db, "capability.embedding-api") as
      | Record<string, unknown>
      | undefined;
    const localAvailable = await isLocalModelAvailable().catch(() => false);
    const items = [
      {
        key: "llm-gateway",
        title: "LLM 网关（OpenAI 兼容）",
        state: llmConfig !== undefined ? "configured" : "off",
        unlocks: "解锁 L1 事实精炼、L2 摘要、L3 画像自动更新",
        requires: ["baseUrl", "apiKey", "model"],
      },
      {
        key: "embedding-api",
        title: "Embedding API",
        state: embedConfig !== undefined ? "configured" : "off",
        unlocks: "云端向量检索（替代本地 transformers.js）",
        requires: ["baseUrl", "apiKey", "model"],
      },
      {
        key: "local-embedding",
        title: "本地 Embedding（transformers.js）",
        state: localAvailable ? "active" : "off",
        unlocks: "离线向量检索（multilingual-e5-small, 384 维）",
        requires: [],
        hint: localAvailable
          ? undefined
          : "未安装 @huggingface/transformers 或未缓存模型；设置 AGENTMEMVIEW_HF_ENDPOINT 可用镜像下载",
      },
      {
        key: "sidecar",
        title: "Python Sidecar",
        state: "off",
        unlocks: "embed/rerank/cluster/consolidate（v1 仅 embed）",
        requires: [],
        hint: "未安装：uv tool install agentmemview-sidecar",
      },
      {
        key: "reranker",
        title: "Reranker（v1.5 槽位）",
        state: "off",
        unlocks: "检索结果重排序（接口已预留）",
        requires: [],
      },
    ];
    return c.json({ items });
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
  });
