import { useEffect, useState } from "react";
import { type Capability, CapabilityCard } from "../components/capability-card.js";
import { api } from "../lib/api.js";

export default function CapabilitiesPage() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getCapabilities()
      .then((page) => setCapabilities(page.items as unknown as Capability[]))
      .catch(() => setCapabilities([]));
  }, []);

  const save = async (key: string, values: Record<string, string>): Promise<void> => {
    await api.putConfig({ [`capability.${key}`]: values });
    setSaved(`已保存 ${key} 配置，热生效无需重启`);
    const page = await api.getCapabilities();
    setCapabilities(page.items as unknown as Capability[]);
  };

  return (
    <div>
      <h2 className="page-title">能力中心</h2>
      <p className="muted">
        未开启任何能力时系统全功能离线可用；开启后解锁对应增强能力（热生效，无需重启）。
      </p>
      {saved !== null && (
        <div className="card" data-testid="save-result">
          {saved}
        </div>
      )}
      <div data-testid="capability-list">
        {capabilities.map((capability) => (
          <CapabilityCard
            key={capability.key}
            capability={capability}
            onSave={(values) => save(capability.key, values)}
          />
        ))}
      </div>
    </div>
  );
}
