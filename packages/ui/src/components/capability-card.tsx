import { useState } from "react";

export interface Capability {
  key: string;
  title: string;
  state: "off" | "configured" | "active" | "error";
  unlocks: string;
  requires: string[];
  hint?: string | undefined;
  error?: string | undefined;
  guide?: string | undefined;
}

const STATE_BADGE: Record<Capability["state"], string> = {
  off: "badge-forgotten",
  configured: "badge-superseded",
  active: "badge-active",
  error: "badge-forgotten",
};

const STATE_LABEL: Record<Capability["state"], string> = {
  off: "未配置",
  configured: "已配置",
  active: "已激活",
  error: "配置不完整",
};

/** Field labels for the unified settings form. */
const FIELD_LABELS: Record<string, string> = {
  baseUrl: "API 地址（baseUrl）",
  apiKey: "API Key",
  model: "模型名（model）",
};

/**
 * Capability card: what you gain, what you need, current state, config form.
 * initial values prefill the form; secrets (apiKey) render masked with a
 * show/hide toggle; clearing saves null which turns the capability off.
 */
export function CapabilityCard({
  capability,
  initial,
  onSave,
}: {
  capability: Capability;
  initial?: Record<string, string> | undefined;
  onSave: (values: Record<string, string | null>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial ?? {});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const configurable = capability.requires.length > 0;
  return (
    <div className="card" data-capability={capability.key}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{capability.title}</strong>
        <span className={`badge ${STATE_BADGE[capability.state]}`}>
          {STATE_LABEL[capability.state]}
        </span>
      </div>
      <p className="muted">{capability.unlocks}</p>
      {configurable && (
        <p className="muted" style={{ fontSize: 12 }}>
          需要配置：{capability.requires.join("、")}
        </p>
      )}
      {capability.error !== undefined && <p className="muted">⚠ {capability.error}</p>}
      {capability.guide !== undefined && <p className="muted">{capability.guide}</p>}
      {capability.hint !== undefined && <p className="muted">{capability.hint}</p>}
      {configurable &&
        (editing ? (
          <div>
            {capability.requires.map((key) => (
              <div key={key} style={{ marginBottom: 8 }}>
                <label className="mono" htmlFor={`${capability.key}-${key}`}>
                  {FIELD_LABELS[key] ?? key}
                </label>
                <input
                  id={`${capability.key}-${key}`}
                  className="btn"
                  style={{ display: "block", width: "100%" }}
                  type={key === "apiKey" && revealed[key] !== true ? "password" : "text"}
                  autoComplete="off"
                  value={values[key] ?? ""}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                />
                {key === "apiKey" && (
                  <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={revealed[key] === true}
                      onChange={(e) => setRevealed({ ...revealed, [key]: e.target.checked })}
                    />
                    显示密钥
                  </label>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void onSave(values).then(() => setEditing(false));
                }}
              >
                保存并热生效
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const cleared: Record<string, string> = {};
                  for (const key of capability.requires) {
                    cleared[key] = "";
                  }
                  void onSave(cleared).then(() => {
                    setValues({});
                    setEditing(false);
                  });
                }}
              >
                清空并停用
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            配置
          </button>
        ))}
    </div>
  );
}
