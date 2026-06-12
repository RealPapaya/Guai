---
name: guai-research
description: Run a deep, cited research dive on a question or a flagged risk/opportunity, and remember it as an investigation.
---

# /guai-research <question>

Work from `D:/Google AI/guai`.

1. Take the user's question (the skill argument). If none was given, look for an open
   investigation or an escalated finding that `needsMoreSignal` (`node scripts/list-hot.mjs`).
2. Spawn the `researcher` subagent (Opus) with the question. It uses WebSearch/WebFetch,
   verifies claims across independent sources, and returns a synthesis with sources, a
   confidence level, a recommended next step, and any `research` findings.
3. Persist its findings by writing them to a temp JSON file and running
   `node scripts/ingest-findings.mjs --file=<tmp>` so they flow through the gate and into
   memory as an ongoing investigation that resurfaces in the brief until closed.
4. Present the synthesis to the user — lead with the answer and the recommendation, and be
   honest about what could not be confirmed.
