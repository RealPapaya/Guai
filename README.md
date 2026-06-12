# Guai — your autonomous chief of staff

Guai is a personal AI **chief of staff**: it proactively monitors your software-dev
activity, AI cost, and email/calendar; tracks projects; detects risks, anomalies, and
opportunities; and tells you what matters — pushing the urgent few, briefing the rest —
while working hard to **not** interrupt you needlessly.

It's a **hybrid**: a portable Node core (memory, the decision gate, ingest, rendering — no
LLM, no Claude Code required) wrapped in a Claude Code layer that wakes it on a schedule,
adds tiered judgment (Opus/Sonnet/Haiku workers), and delivers via push + a morning brief.

## Quick start

```bash
node --test                       # 73 tests: gate, scoring, ingest, cost, comms, control, …
node scripts/seed-demo.mjs        # a demo project watching me/repo (fixtures)
node scripts/run-sweep.mjs --dry  # ingest → gate → persist (no network/LLM)
node scripts/run-brief.mjs        # the executive morning brief, from memory
node scripts/render-dashboard.mjs # state/dashboard.html — open in any browser
node scripts/status.mjs           # current state at a glance
```

## Claude / Codex subscription usage

Guai can reuse the accounts already logged in through Claude Code and Codex CLI. It
does not require API keys for this feature and never stores the CLI OAuth tokens in
Guai's database.

```bash
node scripts/control.mjs usage-sync
node scripts/control.mjs usage-summary
node scripts/control.mjs usage-sessions --provider=codex
```

The desktop **Usage** tab shows subscription quota/reset windows plus token usage by
project, session, and turn. While the desktop app is running in the tray it syncs once
per minute. Web/mobile/other-computer usage is visible in account quota only and cannot
be attributed to a local project.

## Worker execution sidecar

Guai remains the source of truth and safety boundary. Workers receive a strict
task envelope and return findings plus proposed actions. Findings always pass through
Guai's deterministic gate; proposed actions are queued for confirmation and are never
executed by the sidecar.

```bash
npm run sidecar                 # start localhost-only worker bridge
npm run sidecar:sync            # import agents/tools/skills/operators catalog
npm run research -- "question"  # delegate one persistent, traced research task
node scripts/control.mjs tasks
node scripts/control.mjs traces
node scripts/control.mjs catalog
```

The sidecar imports the worker package from its default local checkout. Override with
`GUAI_WORKER_ROOT`, `GUAI_WORKER_CONFIG`, or `GUAI_SIDECAR_PORT`. Set
`GUAI_SIDECAR_TOKEN` on both processes to require bearer authentication.

To go live in Claude Code, run **`/guai-setup`**: it authenticates Gmail/Calendar, checks
your GitHub token, seeds your real projects/repos, and arms the schedule.

## Desktop control panel (`desktop/`)

A small **Electron** app to drive Guai without the terminal: per-domain on/off switches
(dev · cost · email · calendar), config editing with validation, pending-action review,
a live status panel, a **Run sweep now** button, and **Activate** — schedule the daily
report (in-app while open; optionally a durable Windows task that fires even when closed).

```bash
npm run desktop:setup   # one-time: install Electron + generate the tray icon
npm run desktop         # launch the app (lives in the tray)
```

It's **quarantined**: its own `desktop/package.json` (Electron is a dev-only dependency
there) so the portable core stays zero-dependency. Nothing is imported into Electron —
the app only ever spawns `node scripts/control.mjs <cmd>`, the JSON bridge, so the DB
stays single-writer (WAL) and the renderer stays sandboxed (no Node, strict CSP). Like
everything else in Guai, the GUI only **records** action decisions — sending still goes
through `/guai-confirm`.

## The team (tiered intelligence — `.claude/agents/`)

| Worker | Role | Model |
|---|---|---|
| chief-of-staff | prioritize, escalate, propose actions | Opus |
| researcher | deep cited investigations | Opus |
| dev-watcher · inbox-triage · calendar-aide · digest-writer | structured judgment | Sonnet |
| cost-monitor | usage/anomaly arithmetic | Haiku |

## Skills (`/guai-*`)

`sweep` (monitor now · fired by cron) · `brief` (morning brief) · `confirm` (approve drafted
outward actions) · `status` (dashboard) · `research <q>` · `review` (weekly) · `setup`.

## How it decides what reaches you

Every signal becomes a **finding**, scored and run through `core/gate.js` — a pure,
unit-tested function that emits one of: **ignore · store · digest · push · escalate**.
Push is the exception (rate-limited, quiet-hours-aware, cooldown'd); the digest is the
default; outward actions never fire without your `/guai-confirm`.

Design + rationale: `~/.claude/plans/guai-you-snazzy-journal.md`. Conventions: `CLAUDE.md`.
