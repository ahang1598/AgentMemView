import { Compass } from "lucide-react";
import type { ReactNode } from "react";

/** Empty states must be actionable (P0: no hollow placeholder copy). */
export function EmptyState({
  title,
  guidance,
  action,
}: {
  title: string;
  guidance: string;
  action?: ReactNode;
}) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 32 }}>
      <Compass size={24} style={{ color: "var(--text-muted)" }} />
      <h3 style={{ margin: "12px 0 8px" }}>{title}</h3>
      <p className="muted" style={{ margin: "0 0 16px" }}>
        {guidance}
      </p>
      {action}
    </div>
  );
}
