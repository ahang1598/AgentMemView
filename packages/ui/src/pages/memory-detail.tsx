import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LineageTree } from "../components/lineage-tree.js";
import type { Fact } from "../lib/api.js";
import { api } from "../lib/api.js";

export default function MemoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [chain, setChain] = useState<Fact[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (id === undefined) {
      return;
    }
    void api.getMemoryLineage(id).then((result) => setChain(result.chain));
  }, [id]);

  useEffect(load, [load]);

  const latest = chain.length > 0 ? chain[chain.length - 1] : undefined;

  const submitEdit = async (): Promise<void> => {
    if (latest === undefined) {
      return;
    }
    await api.updateMemory(latest.id, draft);
    setEditing(false);
    setMessage("已保存为新版本，旧版本保留在血缘中可回滚查看。");
    load();
  };

  const togglePin = async (): Promise<void> => {
    if (latest === undefined) {
      return;
    }
    const confirmed = window.confirm(
      latest.pinned ? "取消固定该记忆？" : "固定该记忆（豁免衰减）？",
    );
    if (!confirmed) {
      return;
    }
    await api.pinMemory(latest.id, !latest.pinned);
    load();
  };

  const forget = async (): Promise<void> => {
    if (latest === undefined) {
      return;
    }
    const confirmed = window.confirm("标记遗忘？（不物理删除，可在列表中恢复）");
    if (!confirmed) {
      return;
    }
    await api.forgetByQuery(latest.spaceId, latest.content);
    setMessage("已标记遗忘，可在记忆浏览的 forgotten 过滤器中恢复。");
    load();
  };

  if (latest === undefined) {
    return <div className="card">未找到该记忆。</div>;
  }

  return (
    <div>
      <h2 className="page-title">记忆详情</h2>
      <div className="card">
        <span className={`badge badge-${latest.status}`} data-testid="status-badge">
          {latest.status}
        </span>
        {latest.pinned && (
          <span className="badge badge-pinned" style={{ marginLeft: 8 }} data-testid="pin-badge">
            pinned
          </span>
        )}
        <p style={{ fontSize: 15 }}>{latest.content}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="edit-button"
            onClick={() => {
              setDraft(latest.content);
              setEditing(true);
            }}
          >
            编辑
          </button>
          <button
            type="button"
            className="btn"
            data-testid="pin-button"
            onClick={() => void togglePin()}
          >
            {latest.pinned ? "取消固定" : "固定"}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="forget-button"
            onClick={() => void forget()}
          >
            遗忘
          </button>
        </div>
        {message !== null && <p className="muted">{message}</p>}
        {editing && (
          <div style={{ marginTop: 12 }} data-testid="edit-dialog">
            <p className="muted" style={{ fontSize: 12 }}>
              保存即创建新版本（supersede），旧版本保留在血缘中可回滚查看。
            </p>
            <textarea
              className="btn"
              style={{ width: "100%", minHeight: 80 }}
              aria-label="edit-content"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => void submitEdit()}>
                保存新版本
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="card">
        <h3>血缘（旧 → 新）</h3>
        <LineageTree chain={chain} />
      </div>
    </div>
  );
}
