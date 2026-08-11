import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MemokitDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { EventBus, type MemokitEvent } from "../../src/events/bus.js";

let dir: string;
let db: MemokitDatabase;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "memokit-bus-"));
  db = openDatabase(path.join(dir, "memokit.db"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function countEvents(database: MemokitDatabase): number {
  const row = database.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  return row.n;
}

describe("EventBus", () => {
  it("publish persists and notifies", () => {
    const bus = new EventBus(db);
    const received: MemokitEvent[] = [];
    bus.subscribe((event) => {
      received.push(event);
    });

    const before = countEvents(db);
    const payload = { sessionId: "s1", note: "hello" };
    const id = bus.publish("session.started", payload);

    expect(id).toBeGreaterThan(0);
    expect(countEvents(db)).toBe(before + 1);
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("session.started");
    expect(received[0]?.payload).toEqual(payload);
    expect(received[0]?.id).toBe(id);
  });

  it("multiple subscribers isolated (throwing one does not break others)", () => {
    const bus = new EventBus(db);
    const received: string[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe(() => {
      received.push("second");
    });

    expect(() => bus.publish("test.event", {})).not.toThrow();
    expect(received).toEqual(["second"]);
  });

  it("replay since id returns events in order", () => {
    const bus = new EventBus(db);
    const first = bus.publish("e.one", { n: 1 });
    const second = bus.publish("e.two", { n: 2 });
    const third = bus.publish("e.three", { n: 3 });

    const replayed = bus.replay(first);
    expect(replayed.map((e) => e.id)).toEqual([second, third]);
    expect(replayed.map((e) => e.kind)).toEqual(["e.two", "e.three"]);
    expect(replayed[0]?.payload).toEqual({ n: 2 });

    expect(bus.replay(0)).toHaveLength(3);
  });
});
