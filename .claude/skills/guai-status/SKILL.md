---
name: guai-status
description: Show Guai's current state — open findings, pending approvals, cost, and the live dashboard.
---

# /guai-status

Work from `D:/Google AI/guai`.

1. Run `node scripts/status.mjs` and show the summary (projects, open findings by gate
   action, pending approvals, investigations, cost, last run/brief).
2. If `core/render/dashboard.js` exists, run `node scripts/render-dashboard.mjs` to refresh
   `state/dashboard.html` and tell the user the path so they can open it.
3. If anything is pending in the action queue, remind the user they can run `/guai-confirm`.

Keep it brief and scannable.
