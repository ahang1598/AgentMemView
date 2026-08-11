// @agentmemview/core public API — re-exports only, zero business logic here.

export type { ConfigChangeHandler, LoadConfigResult } from "./config/loader.js";
export { ConfigError, loadConfig, watchConfig } from "./config/loader.js";
export type { AgentMemViewConfig } from "./config/schema.js";
export { configSchema } from "./config/schema.js";
export { ConflictError, NotFoundError, ValidationError } from "./dao/errors.js";
export { type IncomingMessage, L0_CHUNK_SIZE, L0Dao, stripEnvelope } from "./dao/l0.js";
export type {
  CreatedFact,
  CreateFactInput,
  FactIndexer,
  FactRow,
  FactStatus,
  ListFactsOptions,
} from "./dao/l1.js";
export { contentHash, DEDUP_WINDOW_MS, FactsDao } from "./dao/l1.js";
export type { Page, PageOptions } from "./dao/page.js";
export type { AgentRow, ServiceRow, SpaceRow } from "./dao/tenants.js";
export { TenantsDao } from "./dao/tenants.js";
export type { AgentMemViewDatabase } from "./db/database.js";
export { openDatabase } from "./db/database.js";
export { defaultMigrationsDir, MigrationError, migrate } from "./db/migrator.js";
export { ensureVecTable, vecTableName } from "./db/vecTables.js";
export {
  isLocalModelAvailable,
  LOCAL_MODEL_DIMS,
  LOCAL_MODEL_ID,
  LocalEmbeddingProvider,
} from "./embedding/local.js";
export { MockEmbeddingProvider } from "./embedding/mock.js";
export type { EmbeddingProvider } from "./embedding/provider.js";
export { assertDims, EmbeddingDimError } from "./embedding/provider.js";
export type { AgentMemViewEvent, EventSubscriber } from "./events/bus.js";
export { EventBus } from "./events/bus.js";
export type { HttpAppOptions, HttpEnv } from "./http/app.js";
export { createHttpApp } from "./http/app.js";
export { handleApiError } from "./http/errors.js";
export type { RunningServer, ServerOptions } from "./http/server.js";
export { startHttpServer } from "./http/server.js";
export type { Logger } from "./logger.js";
export { createLogger } from "./logger.js";
export {
  DEFAULT_REDACTION_RULES,
  type RedactionResult,
  type RedactionRule,
  redact,
} from "./redaction/redactor.js";
export { type DecayInput, ebbinghausFactor } from "./retrieval/decay.js";
export {
  DEFAULT_TOP_K,
  type EngineOptions,
  ensureEngineVecTable,
  RetrievalEngine,
  type SearchOutput,
  type SearchResult,
} from "./retrieval/engine.js";
export {
  type EvalFixture,
  type EvalFixtureFact,
  type EvalFixtureQuery,
  type EvalOptions,
  type EvalReport,
  loadSyntheticFixture,
  runRetrievalEval,
} from "./retrieval/eval.js";
export { type FusedHit, type RankedHit, rrf } from "./retrieval/rrf.js";
export type { Scope } from "./scope/context.js";
export { AGENT_VISIBILITY_SQL, ScopeRequiredError, validateScope } from "./scope/context.js";
export type {
  EmbeddingTriple,
  ExportOptions,
  ImportOptions,
  ImportReport,
  MempackManifest,
} from "./storage/mempack.js";
export { copyDatabase, exportMempack, importMempack, MEMPACK_FORMAT } from "./storage/mempack.js";
