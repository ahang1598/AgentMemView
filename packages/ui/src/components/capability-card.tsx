import { useState } from "react";

export interface Capability {
  key: string;
  title: string;
  state: "off" | "configured" | "active" | "error";
  unlocks: string;
  requires: string[];
  hint?: string | undefined;
}

const STATE_BADGE: Record<Capability["state"], string> = {
  off: "badge-forgotten",
  configured: "badge-superseded",
  active: "badge-active",
  error: "badge-forgotten",
};

/** Capability card: what you gain, what you need, current state, config form. */
export function CapabilityCard({
  capability,
  onSave,
}: {
  capability: Capability;
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="card" data-capability={capability.key}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{capability.title}</strong>
        <span className={`badge ${STATE_BADGE[capability.state]}`}>{capability.state}</span>
      </div>
      <p className="muted">{capability.unlocks}</p>
      {capability.requires.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          需要配置：{capability.requires.join("、")}
        </p>
      )}
      {capability.hint !== undefined && <p className="muted">{capability.hint}</p>}
      {editing ? (
        <div>
          {capability.requires.map((key) => (
            <div key={key} style={{ marginBottom: 8 }}>
              <label className="mono" htmlFor={`${capability.key}-${key}`}>
                {key}
              </label>
              <input
                id={`${capability.key}-${key}`}
                className="btn"
                style={{ display: "block", width: "100%" }}
                value={values[key] ?? ""}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void onSave(values).then(() => setEditing(false));
            }}
          >
            保存并热生效
          </button>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          配置
        </button>
      )}
    </div>
  );
}
