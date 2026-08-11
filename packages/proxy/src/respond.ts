import type { ProxyRoute } from "./routing.js";
import {
  type AnthropicCapture,
  captureAnthropicEvent,
  captureOpenaiChunk,
  mergeOpenaiToolCallDeltas,
  type OpenaiCapture,
  sanitizeAnthropicBody,
  teeStream,
} from "./upstream/sse.js";
import { extractTurnMessages } from "./writeback/extract.js";
import type { L0Client } from "./writeback/l0Client.js";

/** Response-side handling: tee streaming bodies, capture, write-back. */

export function countUserTurns(body: Record<string, unknown>): number {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return 1;
  }
  return Math.max(1, messages.filter((m) => (m as { role?: unknown })?.role === "user").length);
}

export function queueWriteBack(
  l0: L0Client,
  requestBody: Record<string, unknown>,
  sessionId: string,
  assistantText: string,
): void {
  const turn = countUserTurns(requestBody);
  const messages = extractTurnMessages(requestBody, turn);
  if (assistantText.length > 0) {
    messages.push({ turn, role: "assistant", content: assistantText });
  }
  if (messages.length === 0) {
    return;
  }
  try {
    l0.enqueue({ sessionId, messages });
  } catch {
    // fail-open: write-back never breaks the response path
  }
}

export async function respondStream(
  route: ProxyRoute,
  upstream: Response,
  sessionId: string,
  requestBody: Record<string, unknown>,
  l0: L0Client,
): Promise<Response> {
  if (route.protocol === "anthropic") {
    const capture: AnthropicCapture = { text: "", inputTokens: 0, outputTokens: 0 };
    // write-back happens when the stream finishes (flush), once capture is full
    const clientResponse = await teeStream(
      upstream,
      (event, data) => captureAnthropicEvent(capture, event, data),
      () => queueWriteBack(l0, requestBody, sessionId, capture.text),
    );
    return clientResponse;
  }
  // openai: JSON data lines, not event:/data: frames
  const capture: OpenaiCapture = { text: "", toolCalls: [], usage: undefined };
  const body = upstream.body;
  const reader = body?.getReader();
  if (reader === undefined || body === null) {
    return upstream;
  }
  const decoder = new TextDecoder();
  let pending = "";
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk); // byte-identical pass-through
      pending += decoder.decode(chunk, { stream: true });
      let idx = pending.indexOf("\n");
      while (idx !== -1) {
        const line = pending.slice(0, idx).trim();
        pending = pending.slice(idx + 1);
        if (line.startsWith("data:") && line !== "data: [DONE]") {
          try {
            captureOpenaiChunk(capture, JSON.parse(line.slice(5).trim()));
          } catch {
            // fail-open: malformed chunks never break the client stream
          }
        }
        idx = pending.indexOf("\n");
      }
    },
    flush() {
      try {
        const toolNotes = mergeOpenaiToolCallDeltas(capture.toolCalls)
          .map((t) => `[tool_call: ${t.function.name}(${t.function.arguments})]`)
          .join("\n");
        const assistantText = capture.text + (toolNotes.length > 0 ? `\n${toolNotes}` : "");
        queueWriteBack(l0, requestBody, sessionId, assistantText);
      } catch {
        // fail-open
      }
    },
  });
  const clientResponse = new Response(body.pipeThrough(transform), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
  return clientResponse;
}

export async function respondJson(
  route: ProxyRoute,
  upstream: Response,
  sessionId: string,
  requestBody: Record<string, unknown>,
  l0: L0Client,
): Promise<Response> {
  const raw = await upstream.text();
  let assistantText = "";
  try {
    const parsed: unknown = JSON.parse(raw);
    const bodyObj = route.protocol === "anthropic" ? sanitizeAnthropicBody(parsed) : parsed;
    const record = bodyObj as Record<string, unknown>;
    if (route.protocol === "anthropic" && Array.isArray(record.content)) {
      assistantText = (record.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => String(b.text))
        .join("\n");
    }
    if (route.protocol === "openai") {
      const choices = record.choices as Array<Record<string, unknown>> | undefined;
      const message = choices?.[0]?.message as Record<string, unknown> | undefined;
      if (typeof message?.content === "string") {
        assistantText = message.content;
      }
    }
    return new Response(JSON.stringify(bodyObj), {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch {
    return new Response(raw, { status: upstream.status, headers: upstream.headers });
  } finally {
    queueWriteBack(l0, requestBody, sessionId, assistantText);
  }
}
