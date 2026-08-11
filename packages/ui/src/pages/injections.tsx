import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/empty-state.js";
import { TokenBar } from "../components/token-bar.js";
import type { InjectionRow } from "../lib/api.js";
import { api } from "../lib/api.js";
import { formatTime } from "../lib/format.js";
import { useEventStream } from "../lib/sse.js";

function md5Stable(rows: InjectionRow[]): boolean {
  const hashes = rows.map((r) => r.cachePrefixMd5).filter((h): h is string => h !== null);
  return hashes.length > 0 && new Set(hashes).size === 1;
}

export default function InjectionsPage() {
  const [rows, setRows] = useState<InjectionRow[]>([]);
  const [filter, setFilter] = useState("");
  const { events, connected } = useEventStream("/api/v1/injections/stream");

  useEffect(() => {
    void api.listInjections().then((page) => setRows(page.items));
  }, []);

  // SSE rows arrive as { id, data: InjectionRow }; dedupe by id
  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    setRows((current) => {
      const known = new Set(current.map((r) => r.id));
      const fresh = events
        .map((e) => e.data as InjectionRow)
        .filter((row) => typeof row?.id === "string" && !known.has(row.id));
      return fresh.length > 0 ? [...fresh.reverse(), ...current] : current;
    });
  }, [events]);

  const filtered = useMemo(
    () =>
      filter.length === 0 ? rows : rows.filter((row) => (row.sessionId ?? "").includes(filter)),
    [rows, filter],
  );
  const stable = md5Stable(filtered);

  return (
    <div>
      <h2 className="page-title">注入面板（实时）</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <span
          className={`badge ${connected ? "badge-active" : "badge-forgotten"}`}
          data-testid="sse-status"
        >
          {connected ? "实时连接正常" : "连接断开，重连中"}
        </span>
        <span
          className={`badge ${stable ? "badge-active" : "badge-forgotten"}`}
          data-testid="md5-stability"
        >
          {stable ? "KV-cache 前缀稳定" : "前缀 MD5 变化"}
        </span>
        <input
          className="btn"
          placeholder="按会话过滤"
          aria-label="filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          title="尚无注入记录"
          guidance="通过代理发起一轮对话后，这里会实时展示每轮注入了哪些记忆块。"
        />
      ) : (
        <table className="table" data-testid="injection-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>会话</th>
              <th>轮次</th>
              <th>注入块</th>
              <th>token 占比</th>
              <th>前缀 MD5</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="muted">{formatTime(row.createdAt)}</td>
                <td className="mono">{row.sessionId ?? "-"}</td>
                <td>{row.turn}</td>
                <td>{row.blocks.map((b) => b.kind).join(", ")}</td>
                <td style={{ minWidth: 160 }}>
                  <TokenBar blocks={row.blocks} />
                </td>
                <td className="mono">{(row.cachePrefixMd5 ?? "-").slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
