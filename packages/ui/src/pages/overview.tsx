import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/empty-state.js";
import { api } from "../lib/api.js";

interface OverviewStats {
  memories: number;
  injectionsToday: number;
  traces: number;
  sessions: number;
}

export default function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [spaces, injections, traces, sessions] = await Promise.all([
          api.listSpaces(),
          api.listInjections(),
          api.listTraces(),
          api.listSessions(),
        ]);
        let memories = 0;
        for (const space of spaces.items) {
          const page = await api.listMemories(space.id, true);
          memories += page.items.length;
        }
        const today = new Date().toDateString();
        const injectionsToday = injections.items.filter(
          (i) => new Date(i.createdAt).toDateString() === today,
        ).length;
        setStats({
          memories,
          injectionsToday,
          traces: traces.items.length,
          sessions: sessions.items.length,
        });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error !== null) {
    return <div className="card">核心服务不可用：{error}</div>;
  }
  if (stats === null) {
    return <div className="card">正在读取总览数据…</div>;
  }
  if (stats.memories === 0 && stats.sessions === 0) {
    return (
      <EmptyState
        title="还没有任何记忆"
        guidance="接入一个编码 agent 后，对话会自动沉淀为记忆。前往设置页使用接入向导，或用 CLI 执行 agentmemview init。"
        action={
          <Link className="btn btn-primary" to="/settings">
            前往接入向导
          </Link>
        }
      />
    );
  }
  const cards = [
    { label: "记忆总量", value: stats.memories },
    { label: "今日注入", value: stats.injectionsToday },
    { label: "检索轨迹", value: stats.traces },
    { label: "会话数", value: stats.sessions },
  ];
  return (
    <div>
      <h2 className="page-title">总览</h2>
      <div className="grid-4" data-testid="overview-stats">
        {cards.map((card) => (
          <div className="card" key={card.label}>
            <div className="stat-value">{card.value}</div>
            <div className="stat-label">{card.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
