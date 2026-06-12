---
name: guai-sweep
description: Run a Guai monitoring sweep now — ingest dev + cost (and email/calendar if connected), gate, persist, and push only the urgent items. This is what cron fires.
---

# /guai-sweep

Run one monitoring sweep as Guai's chief of staff. Work from the repo root
`D:/Google AI/guai`. If the argument `--light` is present, do only steps 1 and 4
(deterministic dev + cost; skip the MCP workers and chief reasoning) — that's the cheap
hourly cadence.

1. **Deterministic monitors.** Run `node scripts/run-sweep.mjs --trigger=manual`
   (or `--trigger=cron` when fired by cron). This ingests GitHub + AI cost, gates every
   finding, and persists. Read its summary.

2. **MCP workers (skip on `--light`, skip if not authenticated).** In parallel, spawn the
   `inbox-triage` and `calendar-aide` subagents (Agent tool). Each returns `{findings:[…]}`.
   If Gmail/Calendar aren't authenticated, they return empty — that's fine, continue.

3. **Persist worker findings.** If any were returned, write them to a temp JSON file and run
   `node scripts/ingest-findings.mjs --file=<tmp>`. This gates + persists them and queues any
   drafted `proposedAction` as a *pending* item (never sent).

4. **Push the urgent few.** Run `node scripts/select-pushes.mjs`. For each entry in `.send`,
   deliver it with the **PushNotification** tool (`status: "proactive"`, the `text` verbatim).
   Items in `.deferred` are intentionally held for the morning brief — do not push them.

5. **Cross-domain reasoning (skip on `--light`).** If hot items remain, spawn the
   `chief-of-staff` subagent (it reads `node scripts/list-hot.mjs`) to collapse same-root-cause
   items and refine what matters. Record any decisions it returns.

6. **Report.** Summarize: counts by gate action, what was pushed vs deferred, and anything
   newly queued for `/guai-confirm`. Keep it to a few lines — executive tone.

Never send email, comment on PRs, or take any outward action here. Outward actions only
leave Guai through `/guai-confirm`.
