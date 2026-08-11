import { useEffect, useState } from "react";
import { EmptyState } from "../components/empty-state.js";
import { api } from "../lib/api.js";

export default function AssetsPage() {
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [spaceId, setSpaceId] = useState("");
  const [skills, setSkills] = useState<
    Array<{ id: string; name: string; version: number; content: string }>
  >([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void api.listSpaces().then((page) => {
      setSpaces(page.items);
      if (page.items.length > 0 && page.items[0] !== undefined) {
        setSpaceId(page.items[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (spaceId.length === 0) {
      return;
    }
    void api.listSkills(spaceId).then((page) => setSkills(page.items));
  }, [spaceId]);

  return (
    <div>
      <h2 className="page-title">技能与知识</h2>
      <select
        className="btn"
        aria-label="space-select"
        value={spaceId}
        onChange={(e) => setSpaceId(e.target.value)}
        style={{ marginBottom: 16 }}
      >
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
      <div className="card" data-testid="skills-card">
        <h3>技能（版本化）</h3>
        {skills.length === 0 ? (
          <EmptyState
            title="还没有技能"
            guidance="在会话中发送 mem:remember 或手动沉淀工作流后，这里会展示版本化的技能清单。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>版本</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id}>
                  <td>{skill.name}</td>
                  <td>v{skill.version}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`skill-toggle-${skill.id}`}
                      onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
                    >
                      {expanded === skill.id ? "收起" : "查看"}
                    </button>
                    {expanded === skill.id && (
                      <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                        {skill.content}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
