import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type Capability, CapabilityCard } from "../components/capability-card.js";
import { api } from "../lib/api.js";

export default function SettingsPage() {
  const [halfLife, setHalfLife] = useState(30);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // external services AgentMemView itself calls (unified with capability center)
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [capabilityValues, setCapabilityValues] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [capabilitySaved, setCapabilitySaved] = useState<string | null>(null);

  useEffect(() => {
    void api.getConfig().then((config) => {
      const value = (config as Record<string, unknown>).decayHalfLifeDays;
      if (typeof value === "number") {
        setHalfLife(value);
      }
      // prefill capability forms from stored capability.<key> configs
      const values: Record<string, Record<string, string>> = {};
      for (const [key, raw] of Object.entries(config as Record<string, unknown>)) {
        if (!key.startsWith("capability.") || raw === null || typeof raw !== "object") {
          continue;
        }
        const fields: Record<string, string> = {};
        for (const [field, fieldValue] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof fieldValue === "string") {
            fields[field] = fieldValue;
          }
        }
        values[key.slice("capability.".length)] = fields;
      }
      setCapabilityValues(values);
    });
  }, []);

  const refreshCapabilities = (): Promise<void> =>
    api
      .getCapabilities()
      .then((page) => setCapabilities(page.items as unknown as Capability[]))
      .catch(() => setCapabilities([]));

  useEffect(() => {
    void api
      .getCapabilities()
      .then((page) => setCapabilities(page.items as unknown as Capability[]))
      .catch(() => setCapabilities([]));
  }, []);

  const saveCapability = async (
    key: string,
    values: Record<string, string | null>,
  ): Promise<void> => {
    const hasValue = Object.values(values).some((v) => typeof v === "string" && v.trim() !== "");
    const normalized: Record<string, string> = {};
    for (const [field, fieldValue] of Object.entries(values)) {
      if (typeof fieldValue === "string" && fieldValue.trim() !== "") {
        normalized[field] = fieldValue;
      }
    }
    // saving null clears the config entry and turns the capability off (hot)
    await api.putConfig({ [`capability.${key}`]: hasValue ? normalized : null });
    setCapabilityValues({ ...capabilityValues, [key]: normalized });
    setCapabilitySaved(
      hasValue ? `已保存 ${key} 配置，热生效无需重启` : `已清空 ${key} 配置（能力已停用）`,
    );
    await refreshCapabilities();
  };

  const saveDecay = async (): Promise<void> => {
    await api.putConfig({ decayHalfLifeDays: halfLife });
    setSavedMessage(`衰减半衰期已保存为 ${halfLife} 天（热生效）`);
  };

  return (
    <div>
      <h2 className="page-title">设置</h2>
      <div className="card" data-testid="proxy-entry-card">
        <h3>代理与接入</h3>
        <p className="muted">
          透明代理上游地址、Agent 接入（写入 Claude Code / Codex / OpenCode
          配置，合并语义不覆盖无关键）已独立到专门页面管理。
        </p>
        <Link className="btn btn-primary" to="/settings/proxy">
          前往代理配置
        </Link>
      </div>
      <div className="card" data-testid="external-services-card">
        <h3>外部服务（AgentMemView 自身调用的 API）</h3>
        <p className="muted">
          这里是 AgentMemView 精炼/向量化等功能自己调用的外部 API（与代理转发给编码 agent
          的上游不同：代理上游在「代理配置」页管理，API Key 由 agent 自带透传）。
          未配置时系统全功能离线可用；配置后热生效无需重启。
        </p>
        {capabilitySaved !== null && <p className="muted">{capabilitySaved}</p>}
        <div style={{ display: "grid", gap: 12 }} data-testid="external-services-list">
          {capabilities.map((capability) => (
            <CapabilityCard
              key={capability.key}
              capability={capability}
              initial={capabilityValues[capability.key] ?? {}}
              onSave={(values) => saveCapability(capability.key, values)}
            />
          ))}
        </div>
      </div>
      <div className="card" data-testid="decay-card">
        <h3>衰减参数</h3>
        <label htmlFor="half-life">L1 记忆半衰期（天）</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            id="half-life"
            type="range"
            min={1}
            max={180}
            value={halfLife}
            onChange={(e) => setHalfLife(Number(e.target.value))}
          />
          <span>{halfLife} 天</span>
          <button type="button" className="btn btn-primary" onClick={() => void saveDecay()}>
            保存
          </button>
        </div>
        {savedMessage !== null && <p className="muted">{savedMessage}</p>}
      </div>
      <div className="card" data-testid="mempack-card">
        <h3>迁移（.mempack）</h3>
        <p className="muted">
          导出：<code className="mono">agentmemview export --out backup.mempack</code>
          ；导入：<code className="mono">agentmemview import backup.mempack</code>
          。维度不匹配的向量会标记待重建而非拒绝导入。
        </p>
      </div>
    </div>
  );
}
