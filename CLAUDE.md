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

## The split that makes this work

The Workflow-tool sandbox has **no filesystem/Node access**, so anything stateful
(DB, file IO, `fetch`) must run inside an **agent** that shells out to a `node`
script in `scripts/` — never inside a workflow script directly. Pure computation
(merge, dedupe, the gate) may run inline. Concretely:

- **Deterministic, no LLM** → `core/` + `scripts/*.mjs` (ingest, gate, persist, render).
- **Needs judgment** → CC subagents in `agents/` (classify, prioritize, compose, research).

## Conventions

- ESM everywhere (`"type": "module"`). Core files are `.js`, entrypoints are `.mjs`.
- Timestamps are **epoch milliseconds (INTEGER)** in the DB; format only at render time.
- All DB access goes through `core/memory.js` — nothing else touches SQLite.
- The decision gate (`core/gate.js`) is **pure + unit-tested**. It is the heart of
  "minimize unnecessary interruptions". Don't add side effects to it.
- Workers never act outward. Outward actions (send email, PR comment, commit) are
  written to `action_queue` as `pending` and only executed via `/guai-confirm`.
- Secrets come from **env vars** (e.g. `GITHUB_TOKEN`) or optional gitignored
  `state/secrets.json` — never committed, never in `config/`.

## Run commands

```
npm test                  # node --test: gate/scoring/memory truth tables
npm run sweep             # ingest → gate → persist (deterministic; --dry for fixtures)
npm run brief             # render the morning brief from memory
npm run dashboard         # render state/dashboard.html (self-contained)
npm run export            # DB → human-readable JSON snapshot
```

## Where things are

- Data model: `core/schema.sql` (source of truth for every entity Guai tracks).
- Config + thresholds: `config/guai.config.json` (the gate/cost/github knobs).
- Model tiers: `config/models.json`.
- Full design + rationale: `~/.claude/plans/guai-you-snazzy-journal.md`.
