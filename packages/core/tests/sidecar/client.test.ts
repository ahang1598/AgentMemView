import { describe, expect, it } from "vitest";
import { MockEmbeddingProvider } from "../../src/embedding/mock.js";
import { SidecarClient } from "../../src/sidecar/client.js";

describe("sidecar client (M4-07, AC-09)", () => {
  it("spawn failure → state not-installed, embed falls back", async () => {
    const client = new SidecarClient({ command: "agentmemview-sidecar-does-not-exist" });
    const state = await client.start();
    expect(state).toBe("not-installed");
    // degradation contract: embed returns undefined → caller uses fallback
    expect(await client.embed(["text"])).toBeUndefined();
    const fallback = new MockEmbeddingProvider();
    const vectors = await fallback.embed(["text"]);
    expect(vectors[0]).toHaveLength(384);
    client.stop();
  });

  it("handshake happy path against a stub stdio server", async () => {
    const script = `
      const rl = require("node:readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const req = JSON.parse(line);
        if (req.method === "handshake") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {
            name: "stub", version: "0.0.1", protocol: 1, methods: ["embed"] } }) + "\\n");
        } else if (req.method === "embed") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {
            vectors: req.params.texts.map(() => [0.1, 0.2]), dims: 2 } }) + "\\n");
        }
      });
    `;
    const client = new SidecarClient({
      command: process.execPath,
      args: ["-e", script],
      timeoutMs: 4000,
    });
    const state = await client.start();
    expect(state).toBe("active");
    expect(client.handshake?.methods).toContain("embed");
    const vectors = await client.embed(["a", "b"]);
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.1, 0.2],
    ]);
    client.stop();
  });
});
