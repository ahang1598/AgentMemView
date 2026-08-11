import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { NoneLLMProvider } from "../../src/providers/llm/none.js";
import type { LLMProvider } from "../../src/providers/llm/types.js";
import { summarizeSession } from "../../src/refine/l2Summarize.js";
import { updateProfile } from "../../src/refine/l3Profile.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  db: AgentMemViewDatabase;
  spaceId: string;
  sessionId: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-l2l3-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  const agent = tenants.createAgent({ spaceId: space.id, kind: "claude-code", name: "CC" });
  const sessionId = "sess-l2";
  db.prepare(
    "INSERT INTO sessions (id, agent_id, external_id, started_at, meta_json) VALUES (?, ?, NULL, ?, '{}')",
  ).run(sessionId, agent.id, new Date().toISOString());
  const messages = [
    ["m-1", 1, "user", "帮我重构解析器模块，目标是降低耦合"],
    ["m-2", 1, "assistant", "好的，先拆分 tokenizer 与 parser"],
    ["m-3", 2, "user", "测试也要补上"],
  ];
  for (const [id, turn, role, content] of messages) {
    db.prepare(
      "INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at) VALUES (?, ?, ?, 0, ?, ?, 0, 20, ?)",
    ).run(id, sessionId, turn, role, content, new Date().toISOString());
  }
  return { db, spaceId: space.id, sessionId };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("L2/L3 refinement (M4-04)", () => {
  it("l2 rule-based summary creates scenario index with token estimate", () => {
    const { db, spaceId, sessionId } = makeFixture();
    summarizeSession(db, { sessionId, spaceId });
    const rows = db.prepare("SELECT * FROM l2_scenarios WHERE space_id = ?").all(spaceId) as Array<{
      title: string;
      summary: string;
      token_estimate: number;
      source_session_ids_json: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("重构解析器");
    expect(rows[0]?.summary.length).toBeGreaterThan(0);
    expect(rows[0]?.token_estimate).toBeGreaterThan(0);
    expect(rows[0]?.source_session_ids_json).toContain(sessionId);
  });

  it("l3 update versions profile and keeps history", async () => {
    const { db, spaceId } = makeFixture();
    const scopeKey = `space:${spaceId}`;
    const llm: LLMProvider = {
      name: "fake",
      chat: async () => ({ text: "# 画像 v1\n用户偏好 pnpm" }),
    };
    await updateProfile(db, { scopeKey, llm });
    const llm2: LLMProvider = {
      name: "fake",
      chat: async () => ({ text: "# 画像 v2\n用户偏好 pnpm，使用 Windows" }),
    };
    await updateProfile(db, { scopeKey, llm: llm2 });
    const history = db
      .prepare("SELECT version, content_md FROM l3_profiles WHERE scope_key = ? ORDER BY version")
      .all(scopeKey) as Array<{ version: number; content_md: string }>;
    expect(history).toHaveLength(2);
    expect(history[0]?.version).toBe(1);
    expect(history[1]?.content_md).toContain("Windows");
  });

  it("l3 skipped when llm capability off", async () => {
    const { db, spaceId } = makeFixture();
    const scopeKey = `space:${spaceId}`;
    const result = await updateProfile(db, { scopeKey, llm: new NoneLLMProvider() });
    expect(result.skipped).toBe(true);
    const count = db.prepare("SELECT COUNT(*) AS n FROM l3_profiles").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
