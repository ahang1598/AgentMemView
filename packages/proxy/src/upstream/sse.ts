/**
 * SSE tee + capture (Spec section 7 stage 7). The client stream stays
 * byte-identical; a side parser extracts text/usage/tool_calls for L0
 * write-back. Thinking-block sanitizing follows the MemoryProxy report §06.
 */

export interface AnthropicCapture {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface OpenaiToolCallDelta {
  index: number;
  id?: string | undefined;
  type?: string | undefined;
  functionName?: string | undefined;
  argumentChunks: string[];
}

export interface OpenaiCapture {
  text: string;
  toolCalls: OpenaiToolCallDelta[];
  usage?: Record<string, unknown> | undefined;
}

export type SseEventHandler = (event: string, data: string) => void;

/**
 * Pass the upstream SSE response through untouched while parsing frames on a
 * side channel. Handler errors are swallowed (fail-open: observation must
 * never break the business path).
 */
export async function teeStream(
  upstream: Response,
  onEvent: SseEventHandler,
  onDone?: (() => void) | undefined,
): Promise<Response> {
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || upstream.body === null) {
    return upstream;
  }
  const decoder = new TextDecoder();
  let pending = "";
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk); // byte-identical pass-through first
      // parse buffer normalizes CRLF; the client stream keeps raw bytes
      pending += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      let separator = pending.indexOf("\n\n");
      while (separator !== -1) {
        const frame = pending.slice(0, separator);
        pending = pending.slice(separator + 2);
        try {
          const { event, data } = parseFrame(frame);
          if (data.length > 0) {
            onEvent(event, data);
          }
        } catch {
          // fail-open: malformed frames never break the client stream
        }
        separator = pending.indexOf("\n\n");
      }
    },
    flush() {
      try {
        onDone?.();
      } catch {
        // fail-open
      }
    },
  });
  const body = upstream.body.pipeThrough(transform);
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

function parseFrame(frame: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  return { event, data: dataLines.join("\n") };
}

function tryParseJson(data: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function captureAnthropicEvent(
  capture: AnthropicCapture,
  event: string,
  data: string,
): void {
  const parsed = tryParseJson(data);
  if (parsed === undefined) {
    return;
  }
  if (event === "message_start" || parsed.type === "message_start") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage !== undefined) {
      capture.inputTokens = Number(usage.input_tokens ?? 0);
      capture.outputTokens = Number(usage.output_tokens ?? 0);
    }
  }
  if (parsed.type === "content_block_delta") {
    const delta = parsed.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      capture.text += delta.text;
    }
  }
  if (parsed.type === "message_delta") {
    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage !== undefined && usage.output_tokens !== undefined) {
      capture.outputTokens = Number(usage.output_tokens);
    }
  }
}

export function captureOpenaiChunk(capture: OpenaiCapture, chunk: unknown): void {
  if (chunk === null || typeof chunk !== "object") {
    return;
  }
  const record = chunk as Record<string, unknown>;
  if (record.usage !== undefined && record.usage !== null && typeof record.usage === "object") {
    capture.usage = record.usage as Record<string, unknown>;
  }
  const choices = record.choices;
  if (!Array.isArray(choices)) {
    return;
  }
  for (const choice of choices) {
    if (choice === null || typeof choice !== "object") {
      continue;
    }
    const delta = (choice as Record<string, unknown>).delta as Record<string, unknown> | undefined;
    if (delta === undefined) {
      continue;
    }
    if (typeof delta.content === "string") {
      capture.text += delta.content;
    }
    const toolCalls = delta.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const item of toolCalls) {
        if (item === null || typeof item !== "object") {
          continue;
        }
        const call = item as Record<string, unknown>;
        const index = Number(call.index ?? 0);
        let target = capture.toolCalls.find((t) => t.index === index);
        if (target === undefined) {
          target = { index, argumentChunks: [] };
          capture.toolCalls.push(target);
        }
        if (typeof call.id === "string") {
          target.id = call.id;
        }
        if (typeof call.type === "string") {
          target.type = call.type;
        }
        const fn = call.function as Record<string, unknown> | undefined;
        if (fn !== undefined) {
          if (typeof fn.name === "string") {
            target.functionName = fn.name;
          }
          if (typeof fn.arguments === "string") {
            target.argumentChunks.push(fn.arguments);
          }
        }
      }
    }
  }
}

export interface MergedToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export function mergeOpenaiToolCallDeltas(deltas: OpenaiToolCallDelta[]): MergedToolCall[] {
  return [...deltas]
    .sort((a, b) => a.index - b.index)
    .map((delta) => ({
      id: delta.id ?? "",
      type: delta.type ?? "function",
      function: {
        name: delta.functionName ?? "",
        arguments: delta.argumentChunks.join(""),
      },
    }));
}

/**
 * Drop malformed thinking blocks (missing/non-string thinking field) from a
 * non-stream Anthropic message body; all other blocks pass through untouched.
 */
export function sanitizeAnthropicBody(body: unknown): unknown {
  if (body === null || typeof body !== "object") {
    return body;
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.content)) {
    return body;
  }
  record.content = (record.content as unknown[]).filter((block) => {
    if (block === null || typeof block !== "object") {
      return true;
    }
    const typed = block as Record<string, unknown>;
    if (typed.type === "thinking") {
      return typeof typed.thinking === "string";
    }
    return true;
  });
  return record;
}
