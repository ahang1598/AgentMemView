import { useEffect, useState } from "react";
import { type Capability, CapabilityCard } from "../components/capability-card.js";
import { api } from "../lib/api.js";

/**
 * 选配设置页：AgentMemView 自身调用的外部 API（选配能力）统一在这里配置。
 * 与代理上游不同——代理上游在「代理配置」页管理，API Key 由 agent 自带透传；
 * 这里的每一项都是可选增强，未配置时系统全功能离线可用，配置后热生效。
 */
export default function OptionalSettingsPage() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [capabilityValues, setCapabilityValues] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [saved, setSaved] = useState<string | null>(null);

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
    void api.getConfig().then((config) => {
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
    setSaved(hasValue ? `已保存 ${key} 配置，热生效无需重启` : `已清空 ${key} 配置（能力已停用）`);
    await refreshCapabilities();
  };

  return (
    <div>
      <h2 className="page-title">选配设置</h2>
      <div className="card" data-testid="external-services-card">
        <h3>外部服务（AgentMemView 自身调用的 API，全部选配）</h3>
        <p className="muted">
          这里是 AgentMemView 精炼/向量化等功能自己调用的外部 API（与代理转发给编码 agent
          的上游不同：代理上游在「代理配置」页管理，API Key 由 agent 自带透传）。
          每一项都是可选增强：未配置时系统全功能离线可用；配置后热生效无需重启。
        </p>
        {saved !== null && <p className="muted">{saved}</p>}
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
    </div>
  );
}
