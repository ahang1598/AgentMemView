import { useState } from "react";
import type { TraceStage } from "../lib/api.js";

const STAGE_LABELS: Record<string, string> = {
  prefilter: "① 预过滤",
  fts: "② 全文",
  vec: "② 向量",
  rrf: "③ RRF 融合",
  decay: "④ 衰减加权",
  final: "⑤ 最终集",
};

/** Horizontal six-stage stepper with candidate inspection. */
export function TraceStepper({ stages }: { stages: TraceStage[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = stages.find((s) => s.stage === selected);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }} data-testid="trace-stepper">
        {stages.map((stage, index) => (
          <div key={stage.stage} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {index > 0 && (
              <svg width="24" height="10" aria-hidden="true">
                <line x1="0" y1="5" x2="24" y2="5" stroke="var(--border-strong)" strokeWidth="2" />
              </svg>
            )}
            <button
              type="button"
              className="btn"
              data-stage={stage.stage}
              onClick={() => setSelected(stage.stage)}
              style={
                selected === stage.stage
                  ? { borderColor: "var(--accent)", color: "var(--accent)" }
                  : undefined
              }
            >
              {STAGE_LABELS[stage.stage] ?? stage.stage}
              <span className="muted"> ({stage.candidates.length})</span>
            </button>
          </div>
        ))}
      </div>
      {active !== undefined && (
        <div className="card" style={{ marginTop: 12 }} data-testid="stage-candidates">
          <strong>{STAGE_LABELS[active.stage] ?? active.stage} 候选</strong>
          {active.candidates.length === 0 ? (
            <p className="muted">该阶段无候选</p>
          ) : (
            <ul className="mono">
              {active.candidates.slice(0, 30).map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
