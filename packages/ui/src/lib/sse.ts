import { useEffect, useRef, useState } from "react";

/**
 * SSE hook with reconnect + since-id replay. Events carry monotonically
 * increasing ids; on reconnect we pass ?since=lastId so the server replays
 * what we missed, and duplicates are filtered client-side.
 */

export interface StreamOptions {
  /** Injectable EventSource factory (tests supply a mock). */
  eventSourceFactory?: ((url: string) => EventSource) | undefined;
  maxEvents?: number | undefined;
}

export interface StreamEvent {
  id: number;
  data: unknown;
}

export function useEventStream(
  url: string,
  options: StreamOptions = {},
): {
  events: StreamEvent[];
  connected: boolean;
} {
  const [events, setEvents] = useState<StreamEvent[]>();
  const [connected, setConnected] = useState(false);
  const lastIdRef = useRef(0);
  const eventsRef = useRef<StreamEvent[]>([]);
  const maxEvents = options.maxEvents ?? 500;
  // keep an unstable factory reference out of the effect deps
  const factoryRef = useRef(options.eventSourceFactory);
  factoryRef.current = options.eventSourceFactory;

  useEffect(() => {
    eventsRef.current = [];
    // bail out when already empty: keeps unstable option references from
    // triggering a re-render loop
    setEvents((previous) => {
      if (previous === undefined || previous.length === 0) {
        return previous ?? [];
      }
      return [];
    });
    let stopped = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (stopped) {
        return;
      }
      const since = lastIdRef.current;
      const fullUrl = since > 0 ? `${url}${url.includes("?") ? "&" : "?"}since=${since}` : url;
      const make = factoryRef.current ?? ((u: string) => new EventSource(u));
      try {
        source = make(fullUrl);
      } catch {
        retryTimer = setTimeout(connect, 500);
        return;
      }
      source.onopen = () => {
        if (!stopped) {
          setConnected(true);
        }
      };
      source.onmessage = (message) => {
        if (stopped) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.data);
        } catch {
          return;
        }
        const record = parsed as { id?: number };
        const id = typeof record.id === "number" ? record.id : 0;
        if (id > 0 && id <= lastIdRef.current) {
          return; // replayed duplicate
        }
        if (id > 0) {
          lastIdRef.current = id;
        }
        eventsRef.current = [...eventsRef.current.slice(-(maxEvents - 1)), { id, data: parsed }];
        setEvents(eventsRef.current);
      };
      source.onerror = () => {
        if (stopped) {
          return;
        }
        setConnected(false);
        source?.close();
        retryTimer = setTimeout(connect, 500);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [url, maxEvents]);

  return { events: events ?? [], connected };
}
