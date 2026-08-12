import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * 设置页：通用参数入口。专项配置各自独立成页——
 * 代理与 agent 接入 → /settings/proxy；选配能力（外部 API）→ /settings/optional。
 */
export default function SettingsPage() {
  const [halfLife, setHalfLife] = useState(30);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.getConfig().then((config) => {
      const value = (config as Record<string, unknown>).decayHalfLifeDays;
      if (typeof value === "number") {
        setHalfLife(value);
      }
    });
  }, []);

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
          配置，合并语义不覆盖无关键）在专门页面管理。
        </p>
        <Link className="btn btn-primary" to="/settings/proxy">
          前往代理配置
        </Link>
      </div>
      <div className="card" data-testid="optional-entry-card">
        <h3>选配设置（外部服务）</h3>
        <p className="muted">
          AgentMemView 自身调用的外部 API（LLM 网关 / Embedding / Sidecar
          等选配能力）在专门页面配置；未配置时系统全功能离线可用。
        </p>
        <Link className="btn btn-primary" to="/settings/optional">
          前往选配设置
        </Link>
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
