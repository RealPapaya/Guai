// Cost/usage ingest — pure parsers + stats. Two sources:
//   (1) Claude Code's ~/.claude/stats-cache.json (dailyModelTokens)
//   (2) drop-files in state/inbox/ (CSV or JSON exports from any provider)
// Claude Code reports costUSD=0 (subscription), so USD is ESTIMATED from a price
// table; daily token totals are the reliable metric and anomaly detection prefers them.

const round2 = (n) => Math.round(n * 100) / 100;
const dayTs = (date) => Date.parse(date.length <= 10 ? date + 'T00:00:00Z' : date);

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const stddev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

/** Claude Code stats-cache → daily series [{date, ts, tokens, usd, byModel}]. */
export function parseCcStats(stats, pricing = {}) {
  const rate = (m) => pricing[m] ?? pricing.default ?? 0;
  return (stats?.dailyModelTokens ?? [])
    .map((d) => {
      const byModel = d.tokensByModel ?? {};
      let tokens = 0, usd = 0;
      for (const [m, t] of Object.entries(byModel)) { tokens += t; usd += (t * rate(m)) / 1e6; }
      return { date: d.date, ts: dayTs(d.date), tokens, usd: round2(usd), byModel, source: 'cc-stats' };
    })
    .sort((a, b) => a.ts - b.ts);
}

/** Drop-file (CSV "date,usd[,tokens]" or JSON [{date,usd,tokens}]) → daily series. */
export function parseDropContent(text, name = '') {
  let rows;
  if (name.endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
    const j = JSON.parse(text);
    rows = Array.isArray(j) ? j : j.rows ?? j.data ?? [];
  } else {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase().split(',').map((s) => s.trim());
    const di = header.indexOf('date'), ui = header.indexOf('usd') >= 0 ? header.indexOf('usd') : header.indexOf('cost');
    const ti = header.indexOf('tokens');
    rows = lines.slice(1).map((l) => {
      const c = l.split(',');
      return { date: c[di]?.trim(), usd: parseFloat(c[ui] ?? 0), tokens: ti >= 0 ? parseInt(c[ti] ?? 0, 10) : 0 };
    });
  }
  return rows
    .filter((r) => r.date)
    .map((r) => ({ date: r.date, ts: dayTs(r.date), tokens: Number(r.tokens ?? 0), usd: round2(Number(r.usd ?? 0)), source: 'drop-file', raw_ref: name }))
    .sort((a, b) => a.ts - b.ts);
}

/** Rolling baseline over the trailing window (excludes the latest day by default). */
export function summarize(series, windowDays, excludeLatest = true) {
  const s = excludeLatest && series.length ? series.slice(0, -1) : series;
  const win = s.slice(-windowDays);
  return {
    windowDays,
    count: win.length,
    meanUsd: round2(mean(win.map((d) => d.usd))),
    stddevUsd: round2(stddev(win.map((d) => d.usd))),
    meanTokens: Math.round(mean(win.map((d) => d.tokens))),
    stddevTokens: Math.round(stddev(win.map((d) => d.tokens))),
  };
}

/**
 * Anomaly decision over the latest day. Prefers token deviation (reliable) but also
 * checks USD-vs-stddev, day-over-day jump, and projected month-end run-rate.
 * @returns {null | {severity, reasons, detail}}
 */
export function detectAnomaly({ latest, prev, baseline, cfg }) {
  if (!latest || baseline.count < 3) return null; // not enough history to judge
  const k = cfg.cost?.anomalyStdDevK ?? 2;
  const reasons = [];

  const overStdevTokens = baseline.stddevTokens > 0 && latest.tokens > baseline.meanTokens + k * baseline.stddevTokens;
  const overStdevUsd = baseline.stddevUsd > 0 && latest.usd > baseline.meanUsd + k * baseline.stddevUsd;
  if (overStdevTokens) reasons.push(`tokens ${k}σ above baseline`);
  if (overStdevUsd) reasons.push(`spend ${k}σ above baseline`);

  const dodPct = prev && prev.usd > 0 ? ((latest.usd - prev.usd) / prev.usd) * 100 : 0;
  if (dodPct >= (cfg.cost?.dodJumpPct ?? 75)) reasons.push(`+${Math.round(dodPct)}% vs yesterday`);

  const projMonthly = round2(latest.usd * 30);
  const overBudget = projMonthly > (cfg.cost?.monthlyBudgetUsd ?? Infinity);
  if (overBudget) reasons.push(`run-rate $${projMonthly}/mo over $${cfg.cost.monthlyBudgetUsd} budget`);

  if (!reasons.length) return null;
  const ratio = baseline.meanUsd > 0 ? round2(latest.usd / baseline.meanUsd) : null;
  const severity = overBudget ? 4 : (overStdevTokens || overStdevUsd) ? 3 : 2;
  return {
    severity, reasons,
    detail: {
      date: latest.date, todayUsd: latest.usd, todayTokens: latest.tokens,
      baselineUsd: baseline.meanUsd, baselineTokens: baseline.meanTokens,
      ratio, projMonthly, budget: cfg.cost?.monthlyBudgetUsd, byModel: latest.byModel,
    },
  };
}
