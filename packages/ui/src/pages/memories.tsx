import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/empty-state.js";
import { type ScopeSelection, ScopeSwitcher } from "../components/scope-switcher.js";
import type { Fact } from "../lib/api.js";
import { api } from "../lib/api.js";
import { formatDecay, formatTime } from "../lib/format.js";

function decayFactor(fact: Fact, nowMs: number): number {
  if (fact.pinned) {
    return 1;
  }
  const days = Math.max(0, (nowMs - Date.parse(fact.lastAccessedAt)) / 86_400_000);
  return 0.5 ** (days / Math.max(1, fact.halfLifeDays));
}

export default function MemoriesPage() {
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([]);
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selection, setSelection] = useState<ScopeSelection>({});
  const [facts, setFacts] = useState<Fact[]>([]);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    void api.listServices().then((page) => setServices(page.items));
  }, []);

  useEffect(() => {
    if (selection.serviceId === undefined) {
      setSpaces([]);
      return;
    }
    void api.listSpaces(selection.serviceId).then((page) => setSpaces(page.items));
  }, [selection.serviceId]);

  useEffect(() => {
    if (selection.spaceId === undefined) {
      setAgents([]);
      setFacts([]);
      return;
    }
    void api.listAgents(selection.spaceId).then((page) => setAgents(page.items));
    void api
      .listMemories(selection.spaceId, true)
      .then((page) => setFacts(page.items))
      .catch(() => setFacts([]));
  }, [selection.spaceId]);

  const nowMs = Date.now();
  const visible = facts.filter(
    (fact) =>
      statusFilter.length === 0 ||
      (statusFilter === "pinned" ? fact.pinned : fact.status === statusFilter),
  );

  return (
    <div>
      <h2 className="page-title">记忆浏览</h2>
      <ScopeSwitcher
        services={services}
        spaces={spaces}
        agents={agents}
        selection={selection}
        onChange={setSelection}
      />
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        {["", "active", "superseded", "forgotten", "pinned"].map((status) => (
          <button
            key={status}
            type="button"
            className="btn"
            data-status-filter={status}
            style={
              statusFilter === status
                ? { borderColor: "var(--accent)", color: "var(--accent)" }
                : undefined
            }
            onClick={() => setStatusFilter(status)}
          >
            {status === "" ? "全部" : status}
          </button>
        ))}
      </div>
      {selection.spaceId === undefined ? (
        <EmptyState
          title="选择空间开始浏览"
          guidance="按 服务 → 空间 逐级下钻，即可查看该空间下的全部 L1 记忆。"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="该空间暂无记忆"
          guidance="接入 agent 后对话会自动沉淀事实，也可以在会话中发送 mem:remember <事实> 手动写入。"
        />
      ) : (
        <table className="table" data-testid="memory-table">
          <thead>
            <tr>
              <th>内容</th>
              <th>状态</th>
              <th>衰减分</th>
              <th>访问</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((fact) => (
              <tr key={fact.id}>
                <td>
                  <Link to={`/memories/${fact.id}`}>{fact.content}</Link>
                  {fact.pinned && (
                    <span className="badge badge-pinned" style={{ marginLeft: 8 }}>
                      pinned
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge badge-${fact.status}`}>{fact.status}</span>
                </td>
                <td title={`半衰期 ${fact.halfLifeDays} 天`}>
                  {formatDecay(decayFactor(fact, nowMs))}
                </td>
                <td>{fact.accessCount}</td>
                <td className="muted">{formatTime(fact.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
