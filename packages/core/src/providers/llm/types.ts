/**
 * LLM provider contract (Spec section 10). Default is none (offline-first);
 * the capability center hot-swaps in an OpenAI-compatible gateway.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  text: string;
  usage?: ChatUsage | undefined;
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

export class CapabilityOffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityOffError";
  }
}
