# Guai — project memory

Guai is an autonomous personal AI **chief of staff**: it proactively monitors the
owner's world (software-dev activity, AI cost, email/calendar), tracks projects,
detects risks/anomalies/opportunities, and communicates like a reliable executive
assistant — **minimizing interruptions** while never feeling forgetful.

This is a **hybrid** system:

- **Portable core** (`core/`, `config/`, `comms/`, `scripts/`, `state/`): pure Node,
  zero Claude Code dependency. Deterministic work lives here — SQLite memory, the
  decision gate, GitHub/cost ingest, brief/dashboard rendering. Runs with plain
  `node` on any machine. **No LLM/API key required for the deterministic pipeline.**
- **Native CC layer** (`.claude/skills/`, `agents/`, `workflows/`): the live-autonomy
  shell. Cron wakes it, subagents (tiered Opus/Sonnet/Haiku) supply judgment, MCP
  Gmail/Calendar + GitHub REST supply data, `PushNotification` delivers urgent items.
- **Worker sidecar** (`sidecar/`, `core/sidecar.js`): optional execution plane for
  persistent/tool-using workers. It never writes Guai memory directly; returned findings
  and actions must cross `core/worker-results.js` and the deterministic gate.

## The split that makes this work

The Workflow-tool sandbox has **no filesystem/Node access**, so anything stateful
(DB, file IO, `fetch`) must run inside an **agent** that shells out to a `node`
script in `scripts/` — never inside a workflow script directly. Pure computation
(merge, dedupe, the gate) may run inline. Concretely:

- **Deterministic, no LLM** → `core/` + `scripts/*.mjs` (ingest, gate, persist, render).
- **Needs judgment** → CC subagents in `agents/` (classify, prioritize, compose, research).

## The desktop GUI (`desktop/`)

An optional Electron control panel. It is **quarantined** — its own `package.json` with
Electron as a dev dependency, so the core stays zero-dependency and portable. The split
that makes the core/CC layer work applies here too: Electron's main process **never
imports the ESM core** (its bundled Node may lack `node:sqlite`); instead it spawns
`node scripts/control.mjs <cmd>`, the one JSON-in/JSON-out **bridge** that is the entire
IPC surface. So writes stay single-writer (WAL + `busy_timeout`), and the renderer stays
sandboxed (contextIsolation + sandbox + `nodeIntegration:false` + strict CSP) seeing only
`window.guai` from `preload.js`. The GUI **records** action decisions only — sending still
goes through `/guai-confirm`. Main/preload are CommonJS on purpose (no ESM-in-Electron
friction); the renderer is vanilla `@ts-check` JS, no framework. Smoke test:
`GUAI_SMOKE=1 electron .` boots, screenshots, and self-quits.

- New deterministic surface → add a subcommand to `scripts/control.mjs` (reuses `core/`).
- `config.monitors.{dev,cost,email,calendar}` are the per-domain switches: `core/sweep.js`
  honors dev/cost; `workflows/sweep.workflow.js` honors email/calendar (read via the bridge).
- `config.schedule` drives the in-app scheduler (`desktop/main.js`) and the optional
  durable Windows Task Scheduler task (`Guai-DailyBrief`, created by `control.mjs`).

## Conventions

- ESM everywhere (`"type": "module"`). Core files are `.js`, entrypoints are `.mjs`.
- Timestamps are **epoch milliseconds (INTEGER)** in the DB; format only at render time.
- All DB access goes through `core/memory.js` — nothing else touches SQLite.
- The decision gate (`core/gate.js`) is **pure + unit-tested**. It is the heart of
  "minimize unnecessary interruptions". Don't add side effects to it.
- Workers never act outward. Outward actions (send email, PR comment, commit) are
  written to `action_queue` as `pending` and only executed via `/guai-confirm`.
- Workers receive least-privilege capabilities in a task envelope. Sidecar output is
  untrusted until its result contract is validated and Guai gates it.
- Secrets come from **env vars** (e.g. `GITHUB_TOKEN`) or optional gitignored
  `state/secrets.json` — never committed, never in `config/`.

## Run commands

```
npm test                  # node --test: gate/scoring/memory truth tables
npm run sweep             # ingest → gate → persist (deterministic; --dry for fixtures)
npm run brief             # render the morning brief from memory
npm run dashboard         # render state/dashboard.html (self-contained)
npm run export            # DB → human-readable JSON snapshot
npm run control -- status # JSON bridge for the GUI (status|sweep|brief|config-get|…)
npm run desktop:setup     # one-time: install Electron + generate the tray icon
npm run desktop           # launch the desktop control panel (lives in the tray)
```

## Where things are

- Data model: `core/schema.sql` (source of truth for every entity Guai tracks).
- Config + thresholds: `config/guai.config.json` (the gate/cost/github knobs).
- Model tiers: `config/models.json`.
- Full design + rationale: `~/.claude/plans/guai-you-snazzy-journal.md`.
