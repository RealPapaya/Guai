// Keeps the live working set small so context never bloats. Two layers (per the plan):
//  (1) deterministic rollup — collapse aged resolved findings + old run-log into a
//      history_digest row, then delete the raw rows (this function, free, always safe).
//  (2) LLM condense — when open context is huge, the weekly-review skill asks the chief
//      (Sonnet) to summarize older investigations/decisions. That hook lives in the skill.
const DAY = 864e5;

export function maybeCondense(mem, cfg, clock = Date.now()) {
  const c = cfg.condenser ?? {};
  const db = mem.db;
  const findingCut = clock - (c.resolvedFindingAgeDays ?? 14) * DAY;
  const runCut = clock - (c.runLogAgeDays ?? 30) * DAY;
  let condensedFindings = 0, condensedRuns = 0;

  const oldF = db.prepare(
    `SELECT COUNT(*) n, MIN(resolved_at) a, MAX(resolved_at) b FROM findings WHERE status='resolved' AND resolved_at IS NOT NULL AND resolved_at < ?`
  ).get(findingCut);
  if (oldF && oldF.n > 0) {
    mem.addHistoryDigest({ window_start: oldF.a, window_end: oldF.b, summary: `Condensed ${oldF.n} resolved finding(s) older than ${c.resolvedFindingAgeDays ?? 14}d.` });
    db.prepare(`DELETE FROM findings WHERE status='resolved' AND resolved_at IS NOT NULL AND resolved_at < ?`).run(findingCut);
    condensedFindings = oldF.n;
  }

  const oldR = db.prepare(
    `SELECT COUNT(*) n, MIN(ended_at) a, MAX(ended_at) b FROM run_log WHERE ended_at IS NOT NULL AND ended_at < ?`
  ).get(runCut);
  if (oldR && oldR.n > 0) {
    mem.addHistoryDigest({ window_start: oldR.a, window_end: oldR.b, summary: `Condensed ${oldR.n} run-log entr(ies) older than ${c.runLogAgeDays ?? 30}d.` });
    db.prepare(`DELETE FROM run_log WHERE ended_at IS NOT NULL AND ended_at < ?`).run(runCut);
    condensedRuns = oldR.n;
  }

  return { condensedFindings, condensedRuns };
}

/** Does the live open-context exceed the budget? (Signal for the LLM-condense hook.) */
export function needsLlmCondense(mem, cfg) {
  const max = cfg.condenser?.maxOpenContextItems ?? 200;
  return mem.openFindings().length + mem.openInvestigations().length > max;
}
