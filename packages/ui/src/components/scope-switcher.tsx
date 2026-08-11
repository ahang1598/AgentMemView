/** Tenant breadcrumb drill-down: service → space → agent. */
export interface ScopeSelection {
  serviceId?: string | undefined;
  spaceId?: string | undefined;
  agentId?: string | undefined;
}

export function ScopeSwitcher({
  services,
  spaces,
  agents,
  selection,
  onChange,
}: {
  services: Array<{ id: string; name: string }>;
  spaces: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  selection: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }} data-testid="scope-switcher">
      <select
        aria-label="service"
        className="btn"
        value={selection.serviceId ?? ""}
        onChange={(e) => onChange({ serviceId: e.target.value })}
      >
        <option value="">选择服务</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        aria-label="space"
        className="btn"
        value={selection.spaceId ?? ""}
        disabled={selection.serviceId === undefined}
        onChange={(e) => onChange({ ...selection, spaceId: e.target.value })}
      >
        <option value="">选择空间</option>
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        aria-label="agent"
        className="btn"
        value={selection.agentId ?? ""}
        disabled={selection.spaceId === undefined}
        onChange={(e) =>
          onChange({
            ...selection,
            ...(e.target.value !== "" ? { agentId: e.target.value } : {}),
          })
        }
      >
        <option value="">全部 agent</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
