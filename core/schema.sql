-- Guai data model. Source of truth for every entity Guai tracks.
-- All timestamps are epoch milliseconds (INTEGER). Booleans are 0/1.
-- Idempotent: safe to run on every startup (migrations).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Key/value metadata: schema_version, last_brief_ts, etc.
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT
);

-- WATCH TARGETS: what Guai monitors.
CREATE TABLE IF NOT EXISTS watch_targets (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,          -- github_repo | gmail | calendar | cost_source
  ref         TEXT NOT NULL,          -- e.g. "owner/repo", "primary", "console-export"
  config_json TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  UNIQUE(kind, ref)
);

-- PROJECTS: active work Guai tracks ("never forgetful" memory).
CREATE TABLE IF NOT EXISTS projects (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'active',   -- active | paused | done
  repos_json       TEXT,                              -- ["owner/repo", ...]
  owner            TEXT,
  summary          TEXT,
  last_activity_at INTEGER,
  created_at       INTEGER NOT NULL
);

-- FINDINGS / ALERTS: the atomic unit every monitor produces.
CREATE TABLE IF NOT EXISTS findings (
  id             INTEGER PRIMARY KEY,
  source         TEXT NOT NULL,        -- dev | cost | inbox | calendar | research
  kind           TEXT NOT NULL,        -- ci_failure | stale_pr | needs_reply | ...
  target_ref     TEXT,                 -- repo / thread / event identifier
  project_id     INTEGER REFERENCES projects(id),
  title          TEXT NOT NULL,
  detail_json    TEXT,                 -- structured payload (links, numbers, drafts)
  severity       INTEGER NOT NULL DEFAULT 0,   -- 0..4 from the monitor
  priority       REAL NOT NULL DEFAULT 0,      -- computed by scoring.js
  ev_score       REAL NOT NULL DEFAULT 0,      -- expected value (impact - cost)
  gate_action    TEXT,                 -- ignore | store | digest | push | escalate
  status         TEXT NOT NULL DEFAULT 'open', -- open | surfaced | snoozed | resolved | ignored
  fingerprint    TEXT NOT NULL,        -- stable dedupe hash
  times_surfaced INTEGER NOT NULL DEFAULT 0,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  surfaced_at    INTEGER,
  resolved_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_findings_fp      ON findings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_findings_status  ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_seen    ON findings(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_findings_action  ON findings(gate_action);

-- INVESTIGATIONS: multi-step ongoing inquiries (research-analyst memory).
CREATE TABLE IF NOT EXISTS investigations (
  id             INTEGER PRIMARY KEY,
  question       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',  -- open | closed
  findings_json  TEXT,                          -- [findingId, ...]
  summary        TEXT,
  next_step      TEXT,
  model_used     TEXT,
  opened_at      INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- DECISIONS: historical decisions + rationale (so Guai remembers WHY).
CREATE TABLE IF NOT EXISTS decisions (
  id                INTEGER PRIMARY KEY,
  topic             TEXT NOT NULL,
  decision          TEXT NOT NULL,
  rationale         TEXT,
  related_finding_id INTEGER REFERENCES findings(id),
  decided_by        TEXT,                        -- user | guai
  decided_at        INTEGER NOT NULL
);

-- COST: usage records + rolling baselines.
CREATE TABLE IF NOT EXISTS cost_usage (
  id           INTEGER PRIMARY KEY,
  period_start INTEGER NOT NULL,
  period_end   INTEGER NOT NULL,
  source       TEXT NOT NULL,         -- cc-stats | drop-file | manual
  tokens_json  TEXT,
  usd          REAL NOT NULL DEFAULT 0,
  raw_ref      TEXT,                  -- source file name, etc.
  ingested_at  INTEGER NOT NULL,
  UNIQUE(source, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_cost_period ON cost_usage(period_start);

CREATE TABLE IF NOT EXISTS cost_baselines (
  id             INTEGER PRIMARY KEY,
  metric         TEXT NOT NULL,       -- daily_usd | daily_tokens
  window_days    INTEGER NOT NULL,
  baseline_value REAL NOT NULL,
  stddev         REAL NOT NULL DEFAULT 0,
  computed_at    INTEGER NOT NULL,
  UNIQUE(metric, window_days)
);

-- ACTION QUEUE: propose-and-confirm choke point for outward actions.
CREATE TABLE IF NOT EXISTS action_queue (
  id                 INTEGER PRIMARY KEY,
  kind               TEXT NOT NULL,    -- send_email | github_comment | push_commit | calendar_event
  payload_json       TEXT NOT NULL,    -- the drafted action, verbatim
  rationale          TEXT,
  related_finding_id INTEGER REFERENCES findings(id),
  status             TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|executed|failed|expired
  result_json        TEXT,
  proposed_at        INTEGER NOT NULL,
  expires_at         INTEGER,
  decided_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_action_status ON action_queue(status);

-- COMMS LOG: every push/brief sent (rate-limiting + learning feedback).
CREATE TABLE IF NOT EXISTS comms_log (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,         -- push | brief | confirm_request
  finding_id    INTEGER REFERENCES findings(id),
  fingerprint   TEXT,
  text          TEXT,
  sent_at       INTEGER NOT NULL,
  user_response TEXT,                  -- ack | snooze | act | dismiss
  responded_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comms_sent ON comms_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_comms_fp   ON comms_log(fingerprint);

-- RUN LOG: every sweep/brief execution (delta cursor + partial-failure record).
CREATE TABLE IF NOT EXISTS run_log (
  id          INTEGER PRIMARY KEY,
  trigger     TEXT NOT NULL,           -- cron | manual | brief
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  since_ts    INTEGER,
  counts_json TEXT,
  ok          INTEGER NOT NULL DEFAULT 1,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_runlog_ended ON run_log(ended_at);

-- HISTORY DIGEST: condenser output (keeps live context small).
CREATE TABLE IF NOT EXISTS history_digest (
  id           INTEGER PRIMARY KEY,
  window_start INTEGER NOT NULL,
  window_end   INTEGER NOT NULL,
  summary      TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

-- AGENT TASKS: work delegated to the execution sidecar.
CREATE TABLE IF NOT EXISTS agent_tasks (
  task_id          TEXT PRIMARY KEY,
  parent_task_id   TEXT,
  task_type        TEXT NOT NULL,
  objective        TEXT NOT NULL,
  difficulty       TEXT NOT NULL,
  risk_level       INTEGER NOT NULL,
  worker           TEXT,
  status           TEXT NOT NULL,
  envelope_json    TEXT NOT NULL,
  result_json      TEXT,
  error            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);

-- EXECUTION TRACES: Guai-owned index of sidecar executions and outcomes.
CREATE TABLE IF NOT EXISTS execution_traces (
  id             INTEGER PRIMARY KEY,
  trace_id       TEXT NOT NULL UNIQUE,
  task_id        TEXT REFERENCES agent_tasks(task_id),
  worker         TEXT,
  status         TEXT NOT NULL,
  metrics_json   TEXT,
  outcome_json   TEXT,
  recorded_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_traces_task ON execution_traces(task_id);

-- COMPONENT CATALOG: last known worker agents/tools/skills/memory backends.
CREATE TABLE IF NOT EXISTS component_catalog (
  kind           TEXT NOT NULL,
  name           TEXT NOT NULL,
  metadata_json  TEXT,
  source         TEXT NOT NULL DEFAULT 'worker-sidecar',
  synced_at      INTEGER NOT NULL,
  PRIMARY KEY(kind, name)
);
