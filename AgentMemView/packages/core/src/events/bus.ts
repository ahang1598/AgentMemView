import type { AgentMemViewDatabase } from "../db/database.js";

/** A persisted bus event (row of the `events` table). */
export interface AgentMemViewEvent {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type EventSubscriber = (event: AgentMemViewEvent) => void;

interface EventRow {
  id: number;
  kind: string;
  payload_json: string;
  created_at: string;
}

/**
 * In-process pub/sub backed by the `events` table. Publish persists first,
 * then notifies subscribers synchronously; a throwing subscriber is caught
 * and logged, never breaking delivery to the rest. `replay` lets late
 * joiners (SSE clients, M3) catch up from a known event id.
 */
export class EventBus {
  readonly #subscribers = new Set<EventSubscriber>();
  readonly #insert;
  readonly #selectSince;

  constructor(db: AgentMemViewDatabase) {
    this.#insert = db.prepare(
      "INSERT INTO events (kind, payload_json, created_at) VALUES (?, ?, ?)",
    );
    this.#selectSince = db.prepare(
      "SELECT id, kind, payload_json, created_at FROM events WHERE id > ? ORDER BY id ASC",
    );
  }

  /** Persist the event and notify subscribers. Returns the assigned event id. */
  publish(kind: string, payload: Record<string, unknown>): number {
    const createdAt = new Date().toISOString();
    const info = this.#insert.run(kind, JSON.stringify(payload), createdAt);
    const event: AgentMemViewEvent = {
      id: Number(info.lastInsertRowid),
      kind,
      payload,
      createdAt,
    };
    for (const subscriber of this.#subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        console.error(`[agentmemview] event subscriber failed for "${kind}":`, err);
      }
    }
    return event.id;
  }

  /** Register a subscriber; the returned function removes it. */
  subscribe(fn: EventSubscriber): () => void {
    this.#subscribers.add(fn);
    return () => {
      this.#subscribers.delete(fn);
    };
  }

  /** Return all persisted events with id greater than `sinceId`, in order. */
  replay(sinceId: number): AgentMemViewEvent[] {
    const rows = this.#selectSince.all(sinceId) as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }
}
