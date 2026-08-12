import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

interface OnboardAgent {
  agent: string;
  detected: boolean;
  note?: string | undefined;
}

/**
 * 代理配置页：透明代理的上游地址与 agent 接入统一在这里管理。
 * 写入 agent 配置采用合并语义——只覆写管理的键（base-url / 密钥 / 模型 /
 * 窗口 / 超时），settings.json 里其余内容原样保留。
 */
export default function ProxySettingsPage() {
  const [agents, setAgents] = useState<OnboardAgent[]>([]);
  // agent wiring form
  const [onboardAgent, setOnboardAgent] = useState("claude-code");
  const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:8619");
  const [spaceId, setSpaceId] = useState("default");
  const [forceOverwrite, setForceOverwrite] = useState(false);
  // claude-code env overrides (merged, never full overwrite)
  const [authToken, setAuthToken] = useState("");
  const [model, setModel] = useState("");
  const [autoCompactWindow, setAutoCompactWindow] = useState("");
  const [apiTimeoutMs, setApiTimeoutMs] = useState("");
  const [disableTraffic, setDisableTraffic] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // proxy upstream display (read from saved config; runtime value comes from
  // `proxy start` flags/env — see the generated command below)
  const [upstreamAnthropic, setUpstreamAnthropic] = useState("");
  const [upstreamOpenai, setUpstreamOpenai] = useState("");
  const [upstreamSaved, setUpstreamSaved] = useState<string | null>(null);

  const reloadStatus = (): void => {
    void api
      .getOnboardStatus()
      .then((page) => setAgents(page.items as unknown as OnboardAgent[]))
      .catch(() => setAgents([]));
  };

  useEffect(() => {
    void api
      .getOnboardStatus()
      .then((page) => setAgents(page.items as unknown as OnboardAgent[]))
      .catch(() => setAgents([]));
    void api.getConfig().then((config) => {
      const record = config as Record<string, unknown>;
      const anthropic = record["proxy.upstream.anthropic"];
      const openai = record["proxy.upstream.openai"];
      if (typeof anthropic === "string") {
        setUpstreamAnthropic(anthropic);
      }
      if (typeof openai === "string") {
        setUpstreamOpenai(openai);
      }
    });
  }, []);

  const saveUpstreams = async (): Promise<void> => {
    const payload: Record<string, unknown> = {};
    if (upstreamAnthropic.trim() !== "") {
      payload["proxy.upstream.anthropic"] = upstreamAnthropic.trim();
    }
    if (upstreamOpenai.trim() !== "") {
      payload["proxy.upstream.openai"] = upstreamOpenai.trim();
    }
    if (Object.keys(payload).length === 0) {
      setUpstreamSaved("请至少填写一个上游地址");
      return;
    }
    await api.putConfig(payload);
    setUpstreamSaved("已保存。重启代理时用下面生成的命令携带这些上游参数。");
  };

  const applyOnboard = async (): Promise<void> => {
    const claudeEnv: Record<string, unknown> = {};
    if (authToken.trim() !== "") {
      claudeEnv.authToken = authToken.trim();
    }
    if (model.trim() !== "") {
      claudeEnv.defaultHaikuModel = model.trim();
      claudeEnv.defaultSonnetModel = model.trim();
      claudeEnv.defaultOpusModel = model.trim();
    }
    if (autoCompactWindow.trim() !== "") {
      claudeEnv.autoCompactWindow = autoCompactWindow.trim();
    }
    if (apiTimeoutMs.trim() !== "") {
      claudeEnv.apiTimeoutMs = apiTimeoutMs.trim();
    }
    if (disableTraffic) {
      claudeEnv.disableNonessentialTraffic = true;
    }
    try {
      const res = await api.applyOnboard({
        agent: onboardAgent,
        proxyBaseUrl: proxyUrl,
        spaceId,
        ...(forceOverwrite ? { force: true } : {}),
        ...(onboardAgent === "claude-code" && Object.keys(claudeEnv).length > 0
          ? { claudeEnv }
          : {}),
      });
      const note = typeof res.note === "string" ? res.note : "";
      setResult(
        res.changed === true
          ? `已接入：${note}`
          : `未变更${note !== "" ? `：${note}` : ""}（若提示 conflict，勾选强制覆盖后重试）`,
      );
      reloadStatus();
    } catch (err) {
      setResult(`接入失败：${(err as Error).message}`);
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
      setResult(`已还原 ${onboardAgent} 的原始配置（如有备份）`);
      reloadStatus();
    } catch (err) {
      setResult(`还原失败：${(err as Error).message}`);
    }
  };

  const upstreamFlags = [
    upstreamAnthropic.trim() !== "" ? `--anthropic-upstream ${upstreamAnthropic.trim()}` : "",
    upstreamOpenai.trim() !== "" ? `--openai-upstream ${upstreamOpenai.trim()}` : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
  const proxyCommand = `node packages/cli/bin/agentmemview.js proxy start ${upstreamFlags}`.trim();

  return (
    <div>
      <h2 className="page-title">代理配置</h2>

      <div className="card" data-testid="proxy-upstream-card">
        <h3>透明代理上游（Agent 流量的真实 LLM 网关）</h3>
        <p className="muted">
          代理把 agent 的请求原样转发到这些上游（API Key 由 agent 自带透传）。保存后作为{" "}
          <code className="mono">proxy start</code> 的参数使用；运行时解析优先级：命令行参数 &gt;
          AGENTMEMVIEW_UPSTREAM_* 环境变量 &gt; agent 自身的 BASE_URL（防回环）&gt; 官方默认。
        </p>
        <div style={{ display: "grid", gap: 8, maxWidth: 640, marginTop: 8 }}>
          <label htmlFor="upstream-anthropic">
            Anthropic 协议上游（如 https://open.bigmodel.cn/api/anthropic）
          </label>
          <input
            id="upstream-anthropic"
            type="text"
            value={upstreamAnthropic}
            onChange={(e) => setUpstreamAnthropic(e.target.value)}
            placeholder="https://open.bigmodel.cn/api/anthropic"
          />
          <label htmlFor="upstream-openai">
            OpenAI 协议上游（如 https://open.bigmodel.cn/api/coding/paas/v4）
          </label>
          <input
            id="upstream-openai"
            type="text"
            value={upstreamOpenai}
            onChange={(e) => setUpstreamOpenai(e.target.value)}
            placeholder="https://api.openai.com"
          />
          <div>
            <button type="button" className="btn btn-primary" onClick={() => void saveUpstreams()}>
              保存上游地址
            </button>
          </div>
          {upstreamSaved !== null && <p className="muted">{upstreamSaved}</p>}
          <label htmlFor="proxy-command">启动代理命令（复制执行）</label>
          <code id="proxy-command" className="mono" style={{ display: "block", padding: 8 }}>
            {proxyCommand}
          </code>
        </div>
      </div>

      <div className="card" data-testid="proxy-wiring-card">
        <h3>接入 Agent（写入 agent 配置）</h3>
        <p className="muted">
          等价于 CLI <code className="mono">agentmemview init</code>
          。写入采用<strong>合并语义</strong>：只覆写下面填写的键，settings.json
          里其余内容（已有密钥、hooks 等）原样保留；写入前自动备份，可还原。
        </p>
        {agents.length > 0 && (
          <table className="table" style={{ marginTop: 8 }}>
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
        <div style={{ display: "grid", gap: 8, maxWidth: 640, marginTop: 8 }}>
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
          {onboardAgent === "claude-code" && (
            <>
              <label htmlFor="auth-token">密钥（ANTHROPIC_AUTH_TOKEN，留空不改动）</label>
              <input
                id="auth-token"
                type="password"
                autoComplete="off"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="留空 = 保留 settings.json 中现有密钥"
              />
              <label htmlFor="model">
                模型（写入 HAIKU/SONNET/OPUS 三个默认模型，可带 [1m] 后缀）
              </label>
              <input
                id="model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="glm-5.2[1m]"
              />
              <label htmlFor="compact-window">上下文窗口（CLAUDE_CODE_AUTO_COMPACT_WINDOW）</label>
              <input
                id="compact-window"
                type="text"
                value={autoCompactWindow}
                onChange={(e) => setAutoCompactWindow(e.target.value)}
                placeholder="1000000"
              />
              <label htmlFor="api-timeout">请求超时毫秒（API_TIMEOUT_MS）</label>
              <input
                id="api-timeout"
                type="text"
                value={apiTimeoutMs}
                onChange={(e) => setApiTimeoutMs(e.target.value)}
                placeholder="3000000"
              />
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={disableTraffic}
                  onChange={(e) => setDisableTraffic(e.target.checked)}
                />
                禁用非必要流量（CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1）
              </label>
            </>
          )}
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
          {result !== null && <p className="muted">{result}</p>}
        </div>
      </div>
    </div>
  );
}
