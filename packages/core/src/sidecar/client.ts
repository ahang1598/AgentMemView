import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Sidecar client: spawn + line-delimited JSON-RPC + handshake. States:
 * not-installed / active / degraded. Spawn or handshake failure degrades
 * gracefully — callers fall back to the default provider (AC-09).
 */

export type SidecarState = "not-installed" | "active" | "degraded";

export interface SidecarHandshake {
  name: string;
  version: string;
  protocol: number;
  methods: string[];
}

export interface SidecarClientOptions {
  /** Command used to start the sidecar (default: agentmemview-sidecar). */
  command?: string | undefined;
  /** Extra spawn args (tests stub the sidecar with node -e). */
  args?: string[] | undefined;
  timeoutMs?: number | undefined;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SidecarClient {
  readonly #command: string;
  readonly #args: string[];
  readonly #timeoutMs: number;
  #child: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  readonly #pending = new Map<number, PendingCall>();
  #state: SidecarState = "not-installed";
  #handshake: SidecarHandshake | null = null;

  constructor(options: SidecarClientOptions = {}) {
    this.#command = options.command ?? "agentmemview-sidecar";
    this.#args = options.args ?? [];
    this.#timeoutMs = options.timeoutMs ?? 5000;
  }

  get state(): SidecarState {
    return this.#state;
  }

  get handshake(): SidecarHandshake | null {
    return this.#handshake;
  }

  /** Start + handshake. Never throws: failures land in a degraded state. */
  async start(): Promise<SidecarState> {
    try {
      const child = spawn(this.#command, this.#args, { stdio: ["pipe", "pipe", "pipe"] });
      const failed = await new Promise<boolean>((resolve) => {
        child.once("error", () => resolve(true));
        child.once("spawn", () => resolve(false));
      });
      if (failed) {
        this.#state = "not-installed";
        return this.#state;
      }
      this.#child = child;
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        this.#onLine(line);
      });
      child.once("exit", () => {
        this.#state = "degraded";
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("sidecar exited"));
        }
        this.#pending.clear();
      });
      const result = (await this.#call("handshake", {})) as SidecarHandshake;
      if (result.protocol !== 1) {
        this.#state = "degraded";
        this.stop();
        return this.#state;
      }
      this.#handshake = result;
      this.#state = "active";
      return this.#state;
    } catch {
      this.#state = "not-installed";
      return this.#state;
    }
  }

  stop(): void {
    this.#child?.kill();
    this.#child = null;
  }

  async embed(texts: string[], model?: string): Promise<number[][] | undefined> {
    if (this.#state !== "active") {
      return undefined; // caller falls back to the default provider
    }
    try {
      const params: Record<string, unknown> = { texts };
      if (model !== undefined) {
        params.model = model;
      }
      const result = (await this.#call("embed", params)) as { vectors: number[][] };
      return result.vectors;
    } catch {
      return undefined;
    }
  }

  #onLine(line: string): void {
    let parsed: { id?: number; result?: unknown; error?: { message: string } };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return;
    }
    if (typeof parsed.id !== "number") {
      return;
    }
    const pending = this.#pending.get(parsed.id);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(parsed.id);
    clearTimeout(pending.timer);
    if (parsed.error !== undefined) {
      pending.reject(new Error(parsed.error.message));
    } else {
      pending.resolve(parsed.result);
    }
  }

  #call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.#child === null) {
        reject(new Error("sidecar not started"));
        return;
      }
      const id = this.#nextId;
      this.#nextId += 1;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`sidecar call ${method} timeout after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
}
