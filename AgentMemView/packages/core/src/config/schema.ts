import { z } from "zod";

const portSchema = z.number().int().min(1).max(65535);

/**
 * Root config schema for `agentmemview.config.yaml`.
 * Six sections (server/proxy/storage/embedding/llm/decay/capabilities), every
 * field carries a default so a minimal or missing file still yields a full config.
 */
export const configSchema = z.object({
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: portSchema.default(8620),
    })
    .prefault({}),
  proxy: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: portSchema.default(8619),
    })
    .prefault({}),
  storage: z
    .object({
      dataDir: z.string().default("./data"),
      dbFile: z.string().default("agentmemview.db"),
    })
    .prefault({}),
  embedding: z
    .object({
      provider: z.enum(["local", "api", "sidecar"]).default("local"),
      model: z.string().default("multilingual-e5-small"),
      dims: z.number().int().positive().default(384),
    })
    .prefault({}),
  llm: z
    .object({
      provider: z.enum(["none", "gateway"]).default("none"),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .prefault({}),
  decay: z
    .object({
      enabled: z.boolean().default(true),
      halfLifeDays: z.number().positive().default(30),
    })
    .prefault({}),
  capabilities: z
    .object({
      refinement: z.boolean().default(false),
      sidecar: z.boolean().default(false),
      embeddingApi: z.boolean().default(false),
      cloudVector: z.boolean().default(false),
    })
    .prefault({}),
});

export type AgentMemViewConfig = z.infer<typeof configSchema>;
