import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactsDao } from "../../src/dao/l1.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { JobQueue } from "../../src/jobs/queue.js";
import { scheduleSessionRefine } from "../../src/jobs/scheduler.js";
import type { LLMProvider } from "../../src/providers/llm/types.js";
import { HeuristicStrategy, LlmStrategy, runL1Extract } from "../../src/refine/l1Extract.js";
import type { Scope } from "../../src/scope/context.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  db: AgentMemViewDatabase;
  scope: Scope;
  sessionId: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-refine-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  const agent = tenants.createAgent({ spaceId: space.id, kind: "claude-code", name: "CC" });
  const sessionId = "sess-refine";
  db.prepare(
    "INSERT INTO sessions (id, agent_id, external_id, started_at, meta_json) VALUES (?, ?, NULL, ?, '{}')",
  ).run(sessionId, agent.id, new Date().toISOString());
  return { db, scope: { serviceId: svc.id, spaceId: space.id }, sessionId };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeLLM(responseText: string): LLMProvider & { calls: number } {
  const state = { calls: 0 };
  return {
    name: "fake",
    get calls() {
      return state.calls;
    },
    chat: vi.fn(async () => {
      state.calls += 1;
      return { text: responseText };
    }),
  };
}

describe("L1 refinement (M4-03)", () => {
  it("llm path: single add-call inserts facts with lineage to l0", async () => {
    const { db, scope, sessionId } = makeFixture();
    // seed l0 messages
    db.prepare(
      "INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at) VALUES (?, ?, 1, 0, 'user', ?, 0, 10, ?)",
    ).run("m-1", sessionId, "我喜欢用 pnpm", new Date().toISOString());
    const llm = fakeLLM(
      JSON.stringify({
        facts: [{ action: "ADD", content: "用户偏好 pnpm 包管理器" }],
      }),
    );
    const result = await runL1Extract({
      db,
      scope,
      sessionId,
      strategy: new LlmStrategy(llm),
    });
    expect(llm.calls).toBe(1); // write path: exactly one LLM call
    expect(result.inserted).toBe(1);
    const facts = new FactsDao(db, scope).list();
    expect(facts[0]?.content).toBe("用户偏好 pnpm 包管理器");
    expect(facts[0]?.sourceMessageId).toBe("m-1");
  });

  it("contradiction supersedes old fact", async () => {
    const { db, scope, sessionId } = makeFixture();
    const dao = new FactsDao(db, scope);
    const old = dao.create({ content: "部署在 AWS" });
    db.prepare(
      "INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at) VALUES (?, ?, 1, 0, 'user', ?, 0, 10, ?)",
    ).run("m-2", sessionId, "我们现在部署在阿里云", new Date().toISOString());
    const llm = fakeLLM(
      JSON.stringify({
        facts: [{ action: "UPDATE", content: "部署在阿里云", supersedes: "部署在 AWS" }],
      }),
    );
    await runL1Extract({ db, scope, sessionId, strategy: new LlmStrategy(llm) });
    const superseded = dao.get(old.id);
    expect(superseded?.status).toBe("superseded");
    const active = dao.list().map((f) => f.content);
    expect(active).toContain("部署在阿里云");
  });

  it("dirty llm output degrades to heuristic instead of erroring", async () => {
    const { db, scope, sessionId } = makeFixture();
    db.prepare(
      "INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at) VALUES (?, ?, 1, 0, 'user', ?, 0, 10, ?)",
    ).run("m-3", sessionId, "记住：以后测试用 vitest", new Date().toISOString());
    const llm = fakeLLM("this is not json at all");
    const result = await runL1Extract({
      db,
      scope,
      sessionId,
      strategy: new LlmStrategy(llm),
    });
    expect(result.degraded).toBe(true);
    const facts = new FactsDao(db, scope).list();
    expect(facts.some((f) => f.content.includes("vitest"))).toBe(true);
  });

  it("heuristic path extracts remember/correction patterns", async () => {
    const { db, scope, sessionId } = makeFixture();
    db.prepare(
      "INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at) VALUES (?, ?, 1, 0, 'user', ?, 0, 10, ?)",
    ).run("m-4", sessionId, "记住：代码提交前必须跑 lint", new Date().toISOString());
    db.prepare(
      "INSERT INTO l0_messages (id, session_id, turn, seq, role, content, redacted, token_count, created_at) VALUES (?, ?, 2, 0, 'user', ?, 0, 10, ?)",
    ).run("m-5", sessionId, "以后用 pnpm 不用 npm", new Date().toISOString());
    const result = await runL1Extract({
      db,
      scope,
      sessionId,
      strategy: new HeuristicStrategy(),
    });
    expect(result.inserted).toBe(2);
    const contents = new FactsDao(db, scope).list().map((f) => f.content);
    expect(contents.some((c) => c.includes("lint"))).toBe(true);
    expect(contents.some((c) => c.includes("pnpm"))).toBe(true);
  });

  it("AC-02: scheduler dispatches heuristic-only when llm capability off", async () => {
    const { db, sessionId, scope } = makeFixture();
    const queue = new JobQueue(db);
    scheduleSessionRefine(queue, { sessionId, spaceId: scope.spaceId, llmEnabled: false });
    const job = queue.list()[0];
    expect(job?.type).toBe("refine.l1");
    expect(job?.payload.strategy).toBe("heuristic");
    scheduleSessionRefine(queue, { sessionId, spaceId: scope.spaceId, llmEnabled: true });
    const llmJob = queue.list()[0];
    expect(llmJob?.payload.strategy).toBe("llm");
  });
});
