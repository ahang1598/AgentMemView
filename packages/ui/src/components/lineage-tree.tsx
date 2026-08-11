import type { Fact } from "../lib/api.js";
import { formatTime } from "../lib/format.js";

/** Supersede lineage: oldest → newest with status annotations. */
export function LineageTree({ chain }: { chain: Fact[] }) {
  if (chain.length === 0) {
    return <p className="muted">无血缘记录</p>;
  }
  return (
    <ol data-testid="lineage-tree" style={{ paddingLeft: 20 }}>
      {chain.map((fact, index) => (
        <li key={fact.id} style={{ marginBottom: 8 }}>
          <span className={`badge badge-${fact.status}`} style={{ marginRight: 8 }}>
            {fact.status}
          </span>
          <span data-fact-id={fact.id}>{fact.content}</span>
          <span className="muted" style={{ marginLeft: 8 }}>
            v{index + 1} · {formatTime(fact.createdAt)}
          </span>
          {fact.sourceMessageId !== null && (
            <div className="muted mono" style={{ fontSize: 11 }}>
              来源消息: {fact.sourceMessageId}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
