import type { AgentMemViewDatabase } from "../db/database.js";
import { isLocalModelAvailable } from "../embedding/local.js";
import { validateLLMConfig } from "../providers/llm/openai-compat.js";
import type { SidecarState } from "../sidecar/client.js";

/**
 * Capability registry (M4-09): six entries with an off → configured/error →
 * active state machine driven purely by the config table, so PUT /config
 * flips states hot without any restart (AC-08).
 */

export type CapabilityState = "off" | "configured" | "active" | "error";

export interface CapabilityEntry {
  key: string;
  title: string;
  state: CapabilityState;
  unlocks: string;
  requires: string[];
  configKeys: string[];
  guide?: string | undefined;
  error?: string | undefined;
}

function readConfig(db: AgentMemViewDatabase, key: string): Record<string, unknown> | undefined {
  const row = db.prepare("SELECT value_json FROM config WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (row === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(row.value_json);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function gatewayEntry(
  db: AgentMemViewDatabase,
  key: string,
  title: string,
  unlocks: string,
  requires: string[],
): CapabilityEntry {
  const config = readConfig(db, `capability.${key}`);
  const base: CapabilityEntry = {
    key,
    title,
    state: "off",
    unlocks,
    requires,
    configKeys: [`capability.${key}`],
  };
  if (config === undefined) {
    return base;
  }
  const missing = requires.filter((field) => {
    const value = config[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) {
    return { ...base, state: "error", error: `缺少配置：${missing.join("、")}` };
  }
  return { ...base, state: "active" };
}

export async function buildCapabilities(
  db: AgentMemViewDatabase,
  sidecarState: SidecarState = "not-installed",
): Promise<CapabilityEntry[]> {
  const llm = gatewayEntry(
    db,
    "llm-gateway",
    "LLM 网关（OpenAI 兼容）",
    "解锁 L1 事实精炼、L2 摘要、L3 画像自动更新",
    ["baseUrl", "apiKey", "model"],
  );
  // field-level validation doubles as the error message source
  if (llm.state === "error") {
    const config = readConfig(db, "capability.llm-gateway") ?? {};
    const fields = validateLLMConfig(config);
    if (fields.length > 0) {
      llm.error = `缺少配置：${fields.join("、")}`;
    }
  }
  const localAvailable = await isLocalModelAvailable().catch(() => false);
  return [
    llm,
    gatewayEntry(db, "embedding-api", "Embedding API", "云端向量检索（替代本地 transformers.js）", [
      "baseUrl",
      "apiKey",
      "model",
    ]),
    {
      key: "sidecar",
      title: "Python Sidecar",
      state: sidecarState === "active" ? "active" : "off",
      unlocks: "embed/rerank/cluster/consolidate（v1 仅 embed）",
      requires: [],
      configKeys: [],
      ...(sidecarState === "not-installed"
        ? { guide: "未安装：uv tool install ./packages/sidecar" }
        : {}),
      ...(sidecarState === "degraded" ? { error: "sidecar 已退出或握手失败，已降级" } : {}),
    },
    {
      key: "local-embedding",
      title: "本地 Embedding（transformers.js）",
      state: localAvailable ? "active" : "off",
      unlocks: "离线向量检索（multilingual-e5-small, 384 维）",
      requires: [],
      configKeys: [],
      ...(!localAvailable
        ? {
            guide:
              "未安装 @huggingface/transformers 或未缓存模型；设置 AGENTMEMVIEW_HF_ENDPOINT 可用镜像下载",
          }
        : {}),
    },
    {
      key: "cloud-vector",
      title: "云向量存储（v1.5 预留）",
      state: "off",
      unlocks: "VectorStoreProvider 接口已预留（D7），v1.5 接入",
      requires: [],
      configKeys: [],
      guide: "v1 未实现",
    },
    {
      key: "reranker-api",
      title: "Reranker（v1.5 预留）",
      state: "off",
      unlocks: "检索结果重排序槽位",
      requires: [],
      configKeys: [],
      guide: "v1 未实现",
    },
  ];
}
