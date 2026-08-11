import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "../../src/adapters/anthropic.js";
import { InjectionPipeline, type InjectionSources } from "../../src/injection/pipeline.js";
import type { InjectionRecord } from "../../src/injection/prewarm.js";

function makeRecorder(): { records: InjectionRecord[]; record: (r: InjectionRecord) => void } {
  const records: InjectionRecord[] = [];
  return { records, record: (r) => records.push(r) };
}

function makeSources(): InjectionSources {
  return {
    getProfile: async () => "# Profile\nuser prefers pnpm",
    getScenarioIndex: async () => [
      { id: "s-1", title: "Refactor parser", summary: "split tokenizer", tokenEstimate: 40 },
      { id: "s-2", title: "Fix CI", summary: "windows runner", tokenEstimate: 30 },
    ],
    getSkillsList: async () => [{ name: "commit-flow", oneLiner: "conventional commits" }],
  };
}

function rawBody(): Record<string, unknown> {
  return {
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: [{ type: "text", text: "native system", cache_control: { type: "ephemeral" } }],
    tools: [{ name: "read_file", input_schema: {} }],
    messages: [{ role: "user", content: "turn message" }],
  };
}

describe("injection pipeline (M2-05)", () => {
  it("injects at declared points without touching native blocks", async () => {
    const ctx = anthropicAdapter.parse(rawBody());
    const pipeline = new InjectionPipeline({ sources: makeSources() });
    await pipeline.run(ctx, { sessionId: "sess-a", spaceId: "sp", turn: 1 });
    const out = anthropicAdapter.serialize(ctx) as Record<string, unknown>;
    const system = out.system as Array<Record<string, unknown>>;
    // native block preserved verbatim (cache_control intact)
    const native = system.find((b) => b.text === "native system");
    expect(native?.cache_control).toEqual({ type: "ephemeral" });
    // injected blocks appear in the prefix, before native content
    const nativeIndex = system.findIndex((b) => b.text === "native system");
    const profileIndex = system.findIndex((b) => String(b.text).includes("Profile"));
    expect(profileIndex).toBeGreaterThanOrEqual(0);
    expect(profileIndex).toBeLessThan(nativeIndex);
    // memory guide appended as tools
    const tools = out.tools as Array<Record<string, unknown>>;
    expect(tools.some((t) => t.name === "memory_search")).toBe(true);
    expect(tools[0]?.name).toBe("read_file"); // native tools first
  });

  it("prefix md5 stable across 10 turns (AC-03)", async () => {
    const recorder = makeRecorder();
    const pipeline = new InjectionPipeline({ sources: makeSources(), record: recorder.record });
    const hashes = new Set<string>();
    for (let turn = 1; turn <= 10; turn += 1) {
      const ctx = anthropicAdapter.parse(rawBody());
      // each turn carries a different user message
      (ctx.raw.messages as Array<Record<string, unknown>>).push({
        role: "user",
        content: `turn ${turn} content ${Math.random()}`,
      });
      const result = await pipeline.run(ctx, { sessionId: "sess-b", spaceId: "sp", turn });
      hashes.add(result.cachePrefixMd5);
    }
    expect(hashes.size).toBe(1);
    expect(recorder.records).toHaveLength(10);
    const distinct = new Set(recorder.records.map((r) => r.cachePrefixMd5));
    expect(distinct.size).toBe(1);
    expect(recorder.records[0]?.blocks.length).toBeGreaterThan(0);
  });

  it("l0/l1 never auto-injected", async () => {
    const sources: InjectionSources = {
      getProfile: async () => "# Profile\nstable",
      getScenarioIndex: async () => [],
      getSkillsList: async () => [],
      // even if sources offered raw L0/L1 content, the pipeline whitelist
      // only accepts profile/scenarios/skills/guide kinds
    };
    const ctx = anthropicAdapter.parse(rawBody());
    const recorder = makeRecorder();
    const pipeline = new InjectionPipeline({ sources, record: recorder.record });
    await pipeline.run(ctx, { sessionId: "sess-c", spaceId: "sp", turn: 1 });
    const serialized = JSON.stringify(anthropicAdapter.serialize(ctx));
    expect(serialized).not.toContain('"kind":"l0"');
    expect(serialized).not.toContain('"kind":"l1"');
    const kinds = recorder.records[0]?.blocks.map((b) => b.kind) ?? [];
    for (const kind of kinds) {
      expect(["profile", "scenario-index", "skills-list", "memory-guide"]).toContain(kind);
    }
  });

  it("sidequery skips injection entirely", async () => {
    const ctx = anthropicAdapter.parse(rawBody());
    const pipeline = new InjectionPipeline({ sources: makeSources() });
    const result = await pipeline.run(ctx, {
      sessionId: "sess-d",
      spaceId: "sp",
      turn: 1,
      skip: true,
    });
    expect(result.blocks).toEqual([]);
    expect(anthropicAdapter.serialize(ctx)).toEqual(ctx.raw);
  });

  it("token budget enforced with priority L3 > skills > L2", async () => {
    const bigSources: InjectionSources = {
      getProfile: async () => "P".repeat(200), // ~50 tokens
      getScenarioIndex: async () => [
        { id: "s-1", title: "big", summary: "S".repeat(4000), tokenEstimate: 1000 },
      ],
      getSkillsList: async () => [{ name: "skill-a", oneLiner: "K".repeat(400) }],
    };
    const recorder = makeRecorder();
    const pipeline = new InjectionPipeline({
      sources: bigSources,
      maxTokens: 300,
      record: recorder.record,
    });
    const ctx = anthropicAdapter.parse(rawBody());
    const result = await pipeline.run(ctx, { sessionId: "sess-e", spaceId: "sp", turn: 1 });
    const kinds = result.blocks.map((b) => b.kind);
    expect(kinds).toContain("profile"); // highest priority survives
    expect(kinds).toContain("skills-list");
    expect(kinds).not.toContain("scenario-index"); // lowest priority cut
    expect(result.totalTokens).toBeLessThanOrEqual(300);
  });
});
