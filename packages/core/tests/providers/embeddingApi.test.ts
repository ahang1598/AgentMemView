import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentMemViewDatabase, openDatabase } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrator.js";
import { JobQueue } from "../../src/jobs/queue.js";
import { ApiEmbeddingProvider } from "../../src/providers/embedding/api.js";
import { switchEmbeddingProvider } from "../../src/providers/embedding/switch.js";

const tempDirs: string[] = [];
const openDbs: AgentMemViewDatabase[] = [];

function makeDb(): AgentMemViewDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "agentmemview-embedapi-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "agentmemview.db"));
  openDbs.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("embedding API provider (M4-06)", () => {
  it("openai-compatible embed request/response mapped", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { index: 0, embedding: new Array(8).fill(0.1) },
          { index: 1, embedding: new Array(8).fill(0.2) },
        ],
      }),
    })) as unknown as typeof fetch;
    const provider = new ApiEmbeddingProvider(
      { baseUrl: "http://embed", apiKey: "k", model: "text-embed-3", dims: 8 },
      { fetchImpl },
    );
    const vectors = await provider.embed(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(8);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://embed/embeddings");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("text-embed-3");
    expect(body.input).toEqual(["a", "b"]);
  });

  it("switching provider creates new vec table and enqueues rebuild", () => {
    const db = makeDb();
    const queue = new JobQueue(db);
    const report = switchEmbeddingProvider(db, queue, {
      provider: "api",
      model: "text-embed-3",
      dims: 8,
    });
    expect(report.table).toBe("vec_facts_api_text-embed-3_8");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_facts_%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("vec_facts_api_text-embed-3_8");
    // active key persisted + rebuild job queued (keyword-only fallback until rebuilt)
    const config = db
      .prepare("SELECT value_json FROM config WHERE key = 'embedding.activeKey'")
      .get() as {
      value_json: string;
    };
    expect(JSON.parse(config.value_json)).toBe("api_text-embed-3_8");
    const pending = db
      .prepare("SELECT value_json FROM config WHERE key = 'pending_rebuild'")
      .get() as { value_json: string } | undefined;
    expect(pending).toBeDefined();
    const rebuildJobs = queue.list().filter((j) => j.type === "embedding.rebuild");
    expect(rebuildJobs.length).toBe(1);
  });
});
