import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { L0Dao } from "../../src/dao/l0.js";
import { TenantsDao } from "../../src/dao/tenants.js";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { EventBus } from "../../src/events/bus.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

interface Fixture {
  db: AgentMemViewDatabase;
  bus: EventBus;
  sessionId: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-l0-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  const tenants = new TenantsDao(db);
  const svc = tenants.createService({ name: "work" });
  const space = tenants.createSpace({ serviceId: svc.id, name: "default" });
  const agent = tenants.createAgent({ spaceId: space.id, kind: "claude-code", name: "CC" });
  const sessionId = "sess-1";
  db.prepare(
    "INSERT INTO sessions (id, agent_id, external_id, started_at, meta_json) VALUES (?, ?, NULL, ?, '{}')",
  ).run(sessionId, agent.id, new Date().toISOString());
  return { db, bus: new EventBus(db), sessionId };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("L0Dao", () => {
  it("chunks long messages at 8192", () => {
    const { db, bus, sessionId } = makeFixture();
    const dao = new L0Dao(db, bus);
    const long = "x".repeat(20_000);
    dao.appendMessages(sessionId, [{ turn: 1, role: "user", content: long }]);
    const rows = db
      .prepare("SELECT turn, seq, length(content) AS len FROM l0_messages ORDER BY seq")
      .all() as Array<{ turn: number; seq: number; len: number }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ turn: 1, seq: 0, len: 8192 });
    expect(rows[1]).toMatchObject({ turn: 1, seq: 1, len: 8192 });
    expect(rows[2]).toMatchObject({ turn: 1, seq: 2, len: 20_000 - 8192 * 2 });
  });

  it("redacts secrets before insert (AC-07)", () => {
    const { db, bus, sessionId } = makeFixture();
    const dao = new L0Dao(db, bus);
    dao.appendMessages(sessionId, [
      {
        turn: 1,
        role: "user",
        content: "use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcDEF now",
      },
    ]);
    const row = db.prepare("SELECT content, redacted FROM l0_messages").get() as {
      content: string;
      redacted: number;
    };
    expect(row.content).toContain("[REDACTED:anthropic-key]");
    expect(row.content).not.toContain("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz");
    expect(row.redacted).toBe(1);
  });

  it("strips editor envelope from user messages", () => {
    const { db, bus, sessionId } = makeFixture();
    const dao = new L0Dao(db, bus);
    const content =
      "<additional_data><file>big dump</file></additional_data>" +
      "real user question here" +
      "<system-reminder>internal harness note</system-reminder>";
    dao.appendMessages(sessionId, [{ turn: 1, role: "user", content }]);
    const row = db.prepare("SELECT content FROM l0_messages").get() as { content: string };
    expect(row.content).toContain("real user question here");
    expect(row.content).not.toContain("big dump");
    expect(row.content).not.toContain("internal harness note");
    // assistant messages keep envelopes untouched
    dao.appendMessages(sessionId, [
      { turn: 2, role: "assistant", content: "<system-reminder>kept</system-reminder>" },
    ]);
    const assistant = db.prepare("SELECT content FROM l0_messages WHERE turn = 2").get() as {
      content: string;
    };
    expect(assistant.content).toContain("kept");
  });

  it("publishes l0.appended event", () => {
    const { db, bus, sessionId } = makeFixture();
    const dao = new L0Dao(db, bus);
    dao.appendMessages(sessionId, [
      { turn: 1, role: "user", content: "hello" },
      { turn: 1, role: "assistant", content: "hi" },
    ]);
    const events = bus.replay(0).filter((e) => e.kind === "l0.appended");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ sessionId, messages: 2 });
  });
});
