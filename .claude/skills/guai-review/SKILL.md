---
name: guai-review
description: Weekly review — trends across projects and cost, memory housekeeping (condense), and threshold calibration from how you've responded. Fired by the Friday cron.
---

# /guai-review

Work from `D:/Google AI/guai`.

1. Run `node scripts/weekly-review.mjs` for the deterministic rollup: findings opened vs
   resolved, open count by project, 7-day estimated spend, what got condensed, and any
   threshold-calibration suggestions from push feedback.

2. **LLM condense (if flagged).** If the open working set is large, ask the `chief-of-staff`
   subagent (use Sonnet for cost) to summarize older investigations/decisions into a short
   narrative, and record it so next week starts lighter. Do not delete anything the user
   hasn't resolved.

3. **Refresh the dashboard:** `node scripts/render-dashboard.mjs`, and export a snapshot:
   `node scripts/db-export.mjs`.

4. Present a short executive review: what moved this week, what's stuck, the cost trend, and
   any calibration you recommend (the user edits `config/guai.config.json` to apply).

Keep it to a tight, scannable summary — this is a retrospective, not a brief.
