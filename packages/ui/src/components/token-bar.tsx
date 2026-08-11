import { formatTokens } from "../lib/format.js";

/** Per-block token proportions bar (injection panel). */
export function TokenBar({ blocks }: { blocks: Array<{ kind: string; tokens: number }> }) {
  const total = blocks.reduce((sum, b) => sum + b.tokens, 0);
  if (total === 0) {
    return <div className="muted">无 token 记录</div>;
  }
  return (
    <div
      style={{
        display: "flex",
        height: 10,
        borderRadius: 5,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
      data-testid="token-bar"
    >
      {blocks.map((block) => (
        <div
          key={`${block.kind}-${block.tokens}`}
          title={`${block.kind}: ${formatTokens(block.tokens)} (${Math.round((block.tokens / total) * 100)}%)`}
          data-kind={block.kind}
          style={{
            width: `${(block.tokens / total) * 100}%`,
            background: blocks.indexOf(block) % 2 === 0 ? "var(--accent)" : "var(--accent-soft)",
          }}
        />
      ))}
    </div>
  );
}
