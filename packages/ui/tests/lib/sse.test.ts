import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEventStream } from "../../src/lib/sse.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.useRealTimers();
});

describe("useEventStream (M3-02)", () => {
  it("receives events and marks connected", () => {
    const { result } = renderHook(() =>
      useEventStream("/api/v1/injections/stream", {
        eventSourceFactory: (url) => new FakeEventSource(url) as unknown as EventSource,
      }),
    );
    const source = FakeEventSource.instances[0];
    expect(source).toBeDefined();
    act(() => {
      source?.onopen?.();
    });
    expect(result.current.connected).toBe(true);
    act(() => {
      source?.onmessage?.({ data: JSON.stringify({ id: 1, text: "first" }) });
    });
    act(() => {
      source?.onmessage?.({ data: JSON.stringify({ id: 2, text: "second" }) });
    });
    expect(result.current.events).toHaveLength(2);
  });

  it("reconnects with since-id replay and dedupes", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useEventStream("/stream", {
        eventSourceFactory: (url) => new FakeEventSource(url) as unknown as EventSource,
      }),
    );
    const first = FakeEventSource.instances[0];
    act(() => {
      first?.onopen?.();
      first?.onmessage?.({ data: JSON.stringify({ id: 5, value: "a" }) });
    });
    // drop the connection
    act(() => {
      first?.onerror?.();
    });
    expect(first?.closed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const second = FakeEventSource.instances[1];
    expect(second).toBeDefined();
    expect(second?.url).toContain("since=5");
    // replayed duplicate id=5 filtered, id=6 accepted
    act(() => {
      second?.onmessage?.({ data: JSON.stringify({ id: 5, value: "a" }) });
      second?.onmessage?.({ data: JSON.stringify({ id: 6, value: "b" }) });
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events.map((e) => e.id)).toEqual([5, 6]);
  });
});
