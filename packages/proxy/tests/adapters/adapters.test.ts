import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "../../src/adapters/anthropic.js";
import { openaiAdapter } from "../../src/adapters/openai.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

describe("anthropic adapter (golden-file round trip)", () => {
  it("round-trip preserves tool_use/cache_control/thinking blocks", () => {
    const raw = loadFixture("anthropic-request.json");
    const ctx = anthropicAdapter.parse(raw);
    const out = anthropicAdapter.serialize(ctx);
    expect(out).toEqual(raw);
  });

  it("IR exposes system blocks and tools array for injection points", () => {
    const raw = loadFixture("anthropic-request.json");
    const ctx = anthropicAdapter.parse(raw);
    expect(ctx.protocol).toBe("anthropic");
    expect(ctx.model).toBe("claude-opus-4-7");
    expect(ctx.stream).toBe(true);
    expect(ctx.systemBlocks.map((b) => b.text)).toEqual([
      "You are an expert coding assistant.",
      "Second system block without cache control.",
    ]);
    expect(ctx.systemBlocks[0]?.hasCacheControl).toBe(true);
    expect(ctx.tools).toHaveLength(1);
    // injection slots mutate serialize output without touching native blocks
    ctx.injections.systemPrefix.push("[L3 profile] user prefers pnpm");
    ctx.injections.toolsAppend.push({
      name: "memory_search",
      description: "search memory",
      input_schema: { type: "object", properties: {} },
    });
    const out = anthropicAdapter.serialize(ctx) as Record<string, unknown>;
    const system = out.system as Array<{ text: string }>;
    expect(system[0]?.text).toBe("[L3 profile] user prefers pnpm");
    expect(system[1]?.text).toBe("You are an expert coding assistant.");
    expect((system[1] as { cache_control?: unknown }).cache_control).toEqual({
      type: "ephemeral",
    });
    expect((out.tools as unknown[]).length).toBe(2);
    // native messages untouched
    expect(out.messages).toEqual(raw.messages);
    // original fixture not mutated
    expect((raw.system as unknown[]).length).toBe(2);
  });

  it("string system normalizes only when injecting", () => {
    const raw: Record<string, unknown> = {
      model: "claude-opus-4-7",
      max_tokens: 100,
      system: "plain string system",
      messages: [{ role: "user", content: "hi" }],
    };
    const ctx = anthropicAdapter.parse(raw);
    expect(anthropicAdapter.serialize(ctx)).toEqual(raw);
    ctx.injections.systemSuffix.push("[guide] use mem: commands");
    const out = anthropicAdapter.serialize(ctx) as Record<string, unknown>;
    expect(out.system).toEqual([
      { type: "text", text: "plain string system" },
      { type: "text", text: "[guide] use mem: commands" },
    ]);
  });
});

describe("openai adapter (golden-file round trip)", () => {
  it("round-trip preserves tool_calls/function", () => {
    const raw = loadFixture("openai-request.json");
    const ctx = openaiAdapter.parse(raw);
    const out = openaiAdapter.serialize(ctx);
    expect(out).toEqual(raw);
  });

  it("IR exposes system content and tools for injection", () => {
    const raw = loadFixture("openai-request.json");
    const ctx = openaiAdapter.parse(raw);
    expect(ctx.protocol).toBe("openai");
    expect(ctx.systemBlocks.map((b) => b.text)).toEqual(["You are Codex, based on GPT-5."]);
    expect(ctx.tools).toHaveLength(1);
    ctx.injections.systemSuffix.push("[L2 index] scenario list");
    ctx.injections.toolsAppend.push({
      type: "function",
      function: { name: "memory_search", parameters: { type: "object" } },
    });
    const out = openaiAdapter.serialize(ctx) as Record<string, unknown>;
    const messages = out.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("You are Codex, based on GPT-5.");
    expect(messages[0]?.content).toContain("[L2 index] scenario list");
    expect((out.tools as unknown[]).length).toBe(2);
  });

  it("injects system message when original has none", () => {
    const raw: Record<string, unknown> = {
      model: "gpt-5-codex",
      messages: [{ role: "user", content: "hi" }],
    };
    const ctx = openaiAdapter.parse(raw);
    ctx.injections.systemPrefix.push("[L3] profile");
    const out = openaiAdapter.serialize(ctx) as Record<string, unknown>;
    const messages = out.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "[L3] profile" });
    expect(messages[1]?.role).toBe("user");
    // no injection → untouched
    const ctx2 = openaiAdapter.parse(raw);
    expect(openaiAdapter.serialize(ctx2)).toEqual(raw);
  });
});
