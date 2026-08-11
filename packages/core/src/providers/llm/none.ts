import {
  CapabilityOffError,
  type ChatMessage,
  type ChatResult,
  type LLMProvider,
} from "./types.js";

/** Offline-first default: refinement that needs an LLM degrades gracefully. */
export class NoneLLMProvider implements LLMProvider {
  readonly name = "none";

  async chat(_messages: ChatMessage[]): Promise<ChatResult> {
    throw new CapabilityOffError(
      "LLM 能力未开启：在能力中心（Dashboard /capabilities）配置 OpenAI 兼容网关的 baseUrl/apiKey/model 后热生效；离线模式下仅启发式精炼可用。",
    );
  }
}
