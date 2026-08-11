import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type AnthropicCapture,
  captureAnthropicEvent,
  captureOpenaiChunk,
  mergeOpenaiToolCallDeltas,
  type OpenaiCapture,
  sanitizeAnthropicBody,
  teeStream,
} from "../../src/upstream/sse.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

function loadSseFixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

describe("SSE fidelity (M2-04)", () => {
  it("client receives byte-identical stream while tee captures text/usage", async () => {
    const original = loadSseFixture("anthropic-sse.txt");
    const upstream = new Response(
      new ReadableStream({
        start(controller) {
          // split into awkward chunks to prove frame reassembly
          for (let i = 0; i < original.length; i += 37) {
            controller.enqueue(new TextEncoder().encode(original.slice(i, i + 37)));
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    const capture: AnthropicCapture = { text: "", inputTokens: 0, outputTokens: 0 };
    const clientResponse = await teeStream(upstream, (event, data) =>
      captureAnthropicEvent(capture, event, data),
    );
    const received = await clientResponse.text();
    expect(received).toBe(original);
    expect(capture.text).toBe("Hello world");
    expect(capture.inputTokens).toBe(25);
    expect(capture.outputTokens).toBe(12);
  });

  it("openai capture merges tool_call deltas and picks up usage", () => {
    const capture: OpenaiCapture = { text: "", toolCalls: [], usage: undefined };
    const chunks = [
      { choices: [{ delta: { role: "assistant", content: "Plan: " } }] },
      { choices: [{ delta: { content: "run tests" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "she", arguments: "" },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":' } }] } }],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] } }],
      },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 } },
    ];
    for (const chunk of chunks) {
      captureOpenaiChunk(capture, chunk);
    }
    expect(capture.text).toBe("Plan: run tests");
    const merged = mergeOpenaiToolCallDeltas(capture.toolCalls);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "she", arguments: '{"cmd":"ls"}' },
    });
    expect(capture.usage).toEqual({ prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 });
  });

  it("openai streaming body gets stream_options.include_usage", () => {
    // enforced by the pipeline when forwarding streaming openai requests
    const body: Record<string, unknown> = { model: "m", stream: true };
    if (body.stream === true) {
      body.stream_options = { include_usage: true };
    }
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("malformed thinking block sanitized without crashing", () => {
    const body = {
      id: "msg_02",
      content: [
        { type: "thinking", thinking: 42 }, // malformed: non-string
        { type: "thinking", signature: "sig" }, // malformed: missing thinking
        { type: "thinking", thinking: "valid", signature: "sig-2" },
        { type: "text", text: "answer" },
      ],
    };
    const sanitized = sanitizeAnthropicBody(body) as typeof body;
    expect(sanitized.content).toEqual([
      { type: "thinking", thinking: "valid", signature: "sig-2" },
      { type: "text", text: "answer" },
    ]);
  });
});
