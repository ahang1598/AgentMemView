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
  // manual proxy wiring (equivalent of `agentmemview init`)
  const [onboardAgent, setOnboardAgent] = useState("claude-code");
  const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:8619");
  const [spaceId, setSpaceId] = useState("default");
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [onboardResult, setOnboardResult] = useState<string | null>(null);

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

  const reloadOnboardStatus = (): void => {
    void api
      .getOnboardStatus()
      .then((page) => setAgents(page.items as unknown as OnboardAgent[]))
      .catch(() => setAgents([]));
  };

  const applyOnboard = async (): Promise<void> => {
    try {
      const res = await api.applyOnboard({
        agent: onboardAgent,
        proxyBaseUrl: proxyUrl,
        spaceId,
        ...(forceOverwrite ? { force: true } : {}),
      });
      const note = typeof res.note === "string" ? res.note : "";
      setOnboardResult(
        res.changed === true
          ? `已接入：${note}`
          : `未变更${note !== "" ? `：${note}` : ""}（若提示 conflict，勾选强制覆盖后重试）`,
      );
      reloadOnboardStatus();
    } catch (err) {
      setOnboardResult(`接入失败：${(err as Error).message}`);
    }
  };

  const restoreOnboard = async (): Promise<void> => {
    try {
      await api.applyOnboard({
        agent: onboardAgent,
        proxyBaseUrl: proxyUrl,
        spaceId,
        restore: true,
      });
      setOnboardResult(`已还原 ${onboardAgent} 的原始配置（如有备份）`);
      reloadOnboardStatus();
    } catch (err) {
      setOnboardResult(`还原失败：${(err as Error).message}`);
    }
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
      <div className="card" data-testid="onboard-apply-card">
        <h3>手动接入代理（写入 agent 配置）</h3>
        <p className="muted">
          等价于 CLI <code className="mono">agentmemview init</code>
          ：把选中 agent 的 base-url 指向下面的代理地址。代理地址格式为{" "}
          <code className="mono">http://127.0.0.1:8619</code>（代理监听地址，不带路径）； 空间名即{" "}
          <code className="mono">&lt;spaceId&gt;</code>（默认 default）。写入前自动备份，可还原。
        </p>
        <div style={{ display: "grid", gap: 8, maxWidth: 560, marginTop: 8 }}>
          <label htmlFor="onboard-agent">Agent</label>
          <select
            id="onboard-agent"
            value={onboardAgent}
            onChange={(e) => setOnboardAgent(e.target.value)}
          >
            <option value="claude-code">claude-code</option>
            <option value="codex">codex</option>
            <option value="opencode">opencode</option>
          </select>
          <label htmlFor="proxy-url">代理地址（proxy base url）</label>
          <input
            id="proxy-url"
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://127.0.0.1:8619"
          />
          <label htmlFor="space-id">空间名（spaceId）</label>
          <input
            id="space-id"
            type="text"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            placeholder="default"
          />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={forceOverwrite}
              onChange={(e) => setForceOverwrite(e.target.checked)}
            />
            强制覆盖已有 base-url（conflict 时使用；备份保留）
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => void applyOnboard()}>
              接入
            </button>
            <button type="button" className="btn" onClick={() => void restoreOnboard()}>
              还原
            </button>
          </div>
          {onboardResult !== null && <p className="muted">{onboardResult}</p>}
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
