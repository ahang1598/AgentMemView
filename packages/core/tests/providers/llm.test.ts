import { describe, expect, it, vi } from "vitest";
import { NoneLLMProvider } from "../../src/providers/llm/none.js";
import {
  OpenAICompatLLMProvider,
  validateLLMConfig,
} from "../../src/providers/llm/openai-compat.js";
import { CapabilityOffError } from "../../src/providers/llm/types.js";

describe("LLM providers (M4-02)", () => {
  it("none provider throws CapabilityOffError with enable instructions", async () => {
    const provider = new NoneLLMProvider();
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      CapabilityOffError,
    );
    try {
      await provider.chat([{ role: "user", content: "hi" }]);
    } catch (err) {
      expect((err as Error).message).toContain("能力中心");
    }
  });

  it("openai-compat maps chat request/response", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-1",
        choices: [{ message: { role: "assistant", content: '{"facts":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      text: async () => "",
    }));
    const provider = new OpenAICompatLLMProvider(
      { baseUrl: "http://gateway", apiKey: "k", model: "gpt-5-mini" },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    const result = await provider.chat([{ role: "user", content: "extract" }]);
    expect(result.text).toBe('{"facts":[]}');
    expect(result.usage?.promptTokens).toBe(10);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://gateway/chat/completions");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5-mini");
    expect(init?.headers).toMatchObject({ authorization: "Bearer k" });
  });

  it("invalid config → field-level errors", () => {
    const errors = validateLLMConfig({ baseUrl: "", apiKey: "", model: "" });
    expect(errors).toContain("baseUrl");
    expect(errors).toContain("apiKey");
    expect(errors).toContain("model");
    expect(validateLLMConfig({ baseUrl: "http://x", apiKey: "k", model: "m" })).toEqual([]);
  });

  it("retries once on 5xx then surfaces the error", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      calls += 1;
      return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
    });
    const provider = new OpenAICompatLLMProvider(
      { baseUrl: "http://gateway", apiKey: "k", model: "m" },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow(/500/);
    expect(calls).toBe(2);
  });
});
