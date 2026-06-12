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
node --test                       # 63 tests: gate, scoring, ingest, cost, comms, …
node scripts/seed-demo.mjs        # a demo project watching me/repo (fixtures)
node scripts/run-sweep.mjs --dry  # ingest → gate → persist (no network/LLM)
node scripts/run-brief.mjs        # the executive morning brief, from memory
node scripts/render-dashboard.mjs # state/dashboard.html — open in any browser
node scripts/status.mjs           # current state at a glance
```

To go live in Claude Code, run **`/guai-setup`**: it authenticates Gmail/Calendar, checks
your GitHub token, seeds your real projects/repos, and arms the schedule.

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
