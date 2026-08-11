// @memokit/core public API — re-exports only, zero business logic here.

export type { ConfigChangeHandler, LoadConfigResult } from "./config/loader.js";
export { ConfigError, loadConfig, watchConfig } from "./config/loader.js";
export type { MemokitConfig } from "./config/schema.js";
export { configSchema } from "./config/schema.js";
export type { MemokitDatabase } from "./db/database.js";
export { openDatabase } from "./db/database.js";
export { defaultMigrationsDir, MigrationError, migrate } from "./db/migrator.js";
export type { EventSubscriber, MemokitEvent } from "./events/bus.js";
export { EventBus } from "./events/bus.js";
export type { Logger } from "./logger.js";
export { createLogger } from "./logger.js";
