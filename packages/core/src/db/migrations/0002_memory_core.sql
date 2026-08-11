-- 0002_memory_core: memory pipeline tables (Spec section 4).
-- Tenancy discipline: business tables carry service_id/space_id/agent_id;
-- DAO layer enforces scope filtering. All timestamps UTC ISO8601 TEXT.

CREATE TABLE l0_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  turn INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_l0_messages_session ON l0_messages(session_id, turn, seq);

CREATE TABLE l1_facts (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  agent_id TEXT REFERENCES agents(id),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'forgotten')),
  pinned INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 1.0,
  half_life_days REAL NOT NULL DEFAULT 30,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT NOT NULL,
  source_message_id TEXT REFERENCES l0_messages(id),
  superseded_by TEXT REFERENCES l1_facts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_l1_facts_space_status ON l1_facts(space_id, status);
CREATE INDEX idx_l1_facts_space_accessed ON l1_facts(space_id, last_accessed_at);
CREATE INDEX idx_l1_facts_hash ON l1_facts(space_id, content_hash, created_at);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'generic',
  aliases_json TEXT NOT NULL DEFAULT '[]'
);

CREATE UNIQUE INDEX idx_entities_space_name ON entities(space_id, name);

CREATE TABLE l1_fact_entities (
  fact_id TEXT NOT NULL REFERENCES l1_facts(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (fact_id, entity_id)
);

CREATE TABLE l2_scenarios (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  source_session_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE l3_profiles (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  content_md TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_l3_profiles_scope_version ON l3_profiles(scope_key, version);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  history_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- FTS5 trigram index over L1 facts; standalone shadow row keyed by fact_id.
-- Queries shorter than 3 codepoints must fall back to LIKE (trigram limit).
CREATE VIRTUAL TABLE l1_facts_fts USING fts5(
  content,
  fact_id UNINDEXED,
  tokenize = 'trigram'
);

CREATE TABLE retrieval_traces (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  query TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  stages_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  latency_ms REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE injections (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  turn INTEGER NOT NULL DEFAULT 0,
  blocks_json TEXT NOT NULL,
  token_json TEXT NOT NULL DEFAULT '{}',
  cache_prefix_md5 TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_jobs_runnable ON jobs(status, run_after);

CREATE TABLE jobs_dlq (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL,
  last_error TEXT,
  dead_at TEXT NOT NULL
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
