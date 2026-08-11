import { useEffect, useState } from "react";
import { DiffList } from "../components/diff-list.js";
import { EmptyState } from "../components/empty-state.js";
import type { SessionDiff } from "../lib/api.js";
import { api } from "../lib/api.js";
import { formatDay, formatTime } from "../lib/format.js";

interface SessionRow {
  id: string;
  startedAt: string;
  agentId: string;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<SessionDiff | null>(null);

  useEffect(() => {
    void api.listSessions().then((page) => setSessions(page.items));
  }, []);

  useEffect(() => {
    if (selected === null) {
      setDiff(null);
      return;
    }
    void api.sessionDiff(selected).then(setDiff);
  }, [selected]);

  const byDay = new Map<string, SessionRow[]>();
  for (const session of sessions) {
    const day = formatDay(session.startedAt);
    const group = byDay.get(day) ?? [];
    group.push(session);
    byDay.set(day, group);
  }

  return (
    <div>
      <h2 className="page-title">会话时间线</h2>
      {sessions.length === 0 ? (
        <EmptyState
          title="还没有会话"
          guidance="接入 agent 后，每次对话会映射为一个会话，这里展示时间线与每场会话的记忆变更。"
        />
      ) : (
        [...byDay.entries()].map(([day, group]) => (
          <div className="card" key={day} data-day={day}>
            <h3>{day}</h3>
            <table className="table">
              <tbody>
                {group.map((session) => (
                  <tr key={session.id}>
                    <td className="muted">{formatTime(session.startedAt)}</td>
                    <td className="mono">{session.id.slice(0, 8)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        data-testid={`diff-${session.id}`}
                        onClick={() => setSelected(session.id)}
                      >
                        记忆 diff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {diff !== null && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>记忆变更</h3>
          <DiffList diff={diff} />
        </div>
      )}
    </div>
  );
}
