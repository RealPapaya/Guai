---
name: guai-setup
description: One-time Guai setup — authenticate integrations, check the GitHub token, seed projects/watch targets, and arm the schedule.
---

# /guai-setup

Bring Guai online. Work from `D:/Google AI/guai`. Do these in order, confirming with the user
as you go.

1. **Integrations (MCP).** For Gmail and Calendar, run the integration's `authenticate` tool,
   then `complete_authentication` with the code the user provides. Do a tiny read afterward
   (list a few recent threads / upcoming events) to confirm it works. Skip any the user
   doesn't want — sweeps degrade gracefully without them.

2. **GitHub token.** Confirm `GITHUB_TOKEN` is set (env var or `state/secrets.json`, never
   committed). A fine-grained read-only PAT on the repos to watch is enough. Without it, only
   public repos work and at a low rate limit.

3. **What to watch.** Ask the user for their active projects and the repos for each. For each,
   add a project + watch target — e.g. run a small node snippet using `core/memory.js`
   (`upsertProject({name, repos:[…]})`, `addWatchTarget({kind:'github_repo', ref:'owner/repo'})`).
   Also set `config/guai.config.json → github.repos`, quiet hours, timezone, and
   `cost.monthlyBudgetUsd` to match the user.

4. **Smoke test.** Run `node scripts/run-sweep.mjs --trigger=manual` then
   `node scripts/run-brief.mjs` and show the result, so the user sees Guai working end to end.

5. **Arm the schedule.** Run `node scripts/arm-cron.mjs` to get the recommended schedule, then
   create each with the **CronCreate** tool (prompt + cron + `durable:true`). Explain that
   in-session cron only fires while the REPL is idle and expires in ~7 days, so for true 24/7
   autonomy they should also add the Windows Task Scheduler entries printed by the script.

Finish with a one-line summary of what's connected, what's watched, and when Guai will next
run.
