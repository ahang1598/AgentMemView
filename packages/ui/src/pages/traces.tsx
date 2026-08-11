import { useEffect, useState } from "react";
import { EmptyState } from "../components/empty-state.js";
import { TraceStepper } from "../components/trace-stepper.js";
import type { TraceRow } from "../lib/api.js";
import { api } from "../lib/api.js";
import { formatLatency, formatTime } from "../lib/format.js";

export default function TracesPage() {
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [selected, setSelected] = useState<TraceRow | null>(null);

  useEffect(() => {
    void api.listTraces().then((page) => setTraces(page.items));
  }, []);

  const open = async (id: string): Promise<void> => {
    const detail = await api.getTrace(id);
    setSelected(detail);
  };

  return (
    <div>
      <h2 className="page-title">检索轨迹</h2>
      {traces.length === 0 ? (
        <EmptyState
          title="还没有检索记录"
          guidance="每次 /search 或 memory_search 都会落一条六阶段轨迹。在记忆页搜索一次即可在这里回放。"
        />
      ) : (
        <>
          <table className="table" data-testid="trace-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>查询</th>
                <th>耗时</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.id}>
                  <td className="muted">{formatTime(trace.createdAt)}</td>
                  <td>{trace.query}</td>
                  <td data-testid="trace-latency">{formatLatency(trace.latencyMs)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`open-trace-${trace.id}`}
                      onClick={() => void open(trace.id)}
                    >
                      回放
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected !== null && selected.stages !== undefined && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>
                管线回放：{selected.query}
                <span className="muted" style={{ marginLeft: 12 }}>
                  {formatLatency(selected.latencyMs)}
                </span>
              </h3>
              <TraceStepper stages={selected.stages} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
