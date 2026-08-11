import { useEffect, useState } from "react";
import { EmptyState } from "../components/empty-state.js";
import { api } from "../lib/api.js";

export default function ProfilesPage() {
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [spaceId, setSpaceId] = useState("");
  const [contentMd, setContentMd] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<
    Array<{ id: string; title: string; summary: string; tokenEstimate: number }>
  >([]);

  useEffect(() => {
    void api.listSpaces().then((page) => {
      setSpaces(page.items);
      if (page.items.length > 0 && page.items[0] !== undefined) {
        setSpaceId(page.items[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (spaceId.length === 0) {
      return;
    }
    void api.getProfile(`space:${spaceId}`).then((result) => setContentMd(result.contentMd));
    void api.listScenarios(spaceId).then((page) => setScenarios(page.items));
  }, [spaceId]);

  return (
    <div>
      <h2 className="page-title">画像与场景</h2>
      <select
        className="btn"
        aria-label="space-select"
        value={spaceId}
        onChange={(e) => setSpaceId(e.target.value)}
        style={{ marginBottom: 16 }}
      >
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
      <div className="card" data-testid="profile-card">
        <h3>L3 画像（每轮全文注入，字节稳定）</h3>
        {contentMd === null ? (
          <EmptyState
            title="尚未生成画像"
            guidance="开启 LLM 网关能力后，画像会按会话频率自动更新；也可以在 M4 能力中心手动触发。"
          />
        ) : (
          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
            {contentMd}
          </pre>
        )}
      </div>
      <div className="card" data-testid="scenario-card">
        <h3>L2 场景索引（每轮注入索引，全文按需读取）</h3>
        {scenarios.length === 0 ? (
          <p className="muted">该空间暂无场景索引。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>摘要</th>
                <th>token 预估</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario.id}>
                  <td>{scenario.title}</td>
                  <td>{scenario.summary}</td>
                  <td>{scenario.tokenEstimate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
