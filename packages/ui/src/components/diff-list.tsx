import type { Fact, SessionDiff } from "../lib/api.js";

function FactColumn({ title, facts }: { title: string; facts: Fact[] }) {
  return (
    <div style={{ flex: 1 }}>
      <h4>{title}</h4>
      {facts.length === 0 ? (
        <p className="muted">无</p>
      ) : (
        <ul>
          {facts.map((fact) => (
            <li key={fact.id}>{fact.content}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Session memory diff: added / updated / forgotten three columns. */
export function DiffList({ diff }: { diff: SessionDiff }) {
  const empty = diff.added.length === 0 && diff.updated.length === 0 && diff.forgotten.length === 0;
  if (empty) {
    return (
      <div className="card" data-testid="diff-empty">
        本次会话未产生记忆变更。如需立即提炼，请在会话中发送 <code className="mono">mem:sync</code>
        。
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 16 }} data-testid="diff-list">
      <FactColumn title={`新增 (${diff.added.length})`} facts={diff.added} />
      <FactColumn title={`更新 (${diff.updated.length})`} facts={diff.updated} />
      <FactColumn title={`遗忘 (${diff.forgotten.length})`} facts={diff.forgotten} />
    </div>
  );
}
