---
name: guai-brief
description: Compose and deliver Guai's executive morning brief — a single headline push plus the full brief, drawn from memory.
---

# /guai-brief

Produce the morning brief. Work from `D:/Google AI/guai`.

1. **Freshness.** If the last sweep is stale (or you're unsure), run
   `node scripts/run-sweep.mjs --trigger=brief` first so the brief reflects current state.

2. **Render.** Run `node scripts/run-brief.mjs`. This builds the brief deterministically from
   memory (Needs-your-decision → Priority → By project → Cost → Investigations → Watching).

3. **Voice it (optional, recommended).** Pass the rendered Markdown to the `digest-writer`
   subagent to tighten tone and concision — it must not invent any fact. It returns the
   polished brief plus a one-line headline (≤200 chars).

4. **Deliver.** Show the full brief to the user. Send the headline with **PushNotification**
   (`status: "proactive"`) — exactly **one** push for the brief.

5. **Advance the cursor.** Run `node scripts/mark-brief.mjs` so the next brief covers only
   what's new since this one.

Tone: concise, professional, every item ends with a recommendation. If nothing needs
attention, say so in one line — don't manufacture content.
