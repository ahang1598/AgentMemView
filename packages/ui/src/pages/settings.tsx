import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

interface OnboardAgent {
  agent: string;
  detected: boolean;
  note?: string | undefined;
}

export default function SettingsPage() {
  const [agents, setAgents] = useState<OnboardAgent[]>([]);
  const [halfLife, setHalfLife] = useState(30);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getOnboardStatus()
      .then((page) => setAgents(page.items as unknown as OnboardAgent[]))
      .catch(() => setAgents([]));
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
      <div className="card" data-testid="onboard-card">
        <h3>接入向导</h3>
        <p className="muted">
          检测本机 agent 配置；执行{" "}
          <code className="mono">agentmemview init --agent &lt;名称&gt;</code>
          完成写入（幂等，可 --restore 还原）。
        </p>
        {agents.length === 0 ? (
          <p className="muted">未检测到已支持的 agent 配置文件。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agent}>
                  <td>{agent.agent}</td>
                  <td>
                    <span
                      className={`badge ${agent.detected ? "badge-active" : "badge-superseded"}`}
                    >
                      {agent.detected ? "已接入" : "未接入"}
                    </span>
                    {agent.note !== undefined && (
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {agent.note}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
