// Cost monitor: ingest usage (cc-stats + drop-files) into memory, refresh the
// rolling baseline, and emit a cost_anomaly finding when the latest day is off-trend
// or over budget. Returns raw (ungated) findings; the sweep gates + persists them.
import { readFileSync, readdirSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseCcStats, parseDropContent, summarize, detectAnomaly } from './ingest/cost.js';
import { paths } from './config.js';

const round2 = (n) => Math.round(n * 100) / 100;

function loadStats(dry) {
  if (dry) return JSON.parse(readFileSync(join(paths.fixtures, 'stats-cache.json'), 'utf8'));
  const f = join(homedir(), '.claude', 'stats-cache.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { dailyModelTokens: [] };
}

function readDropFiles() {
  if (!existsSync(paths.inbox)) return [];
  const out = [];
  for (const name of readdirSync(paths.inbox)) {
    if (name.startsWith('.') || name === 'processed' || !/\.(csv|json)$/i.test(name)) continue;
    const full = join(paths.inbox, name);
    try { out.push({ name, full, series: parseDropContent(readFileSync(full, 'utf8'), name) }); }
    catch (e) { out.push({ name, full, error: e.message }); }
  }
  return out;
}

function archive(full, name) {
  const pdir = join(paths.inbox, 'processed');
  mkdirSync(pdir, { recursive: true });
  try { renameSync(full, join(pdir, name)); } catch { /* best effort */ }
}

export function runCostMonitor(mem, cfg, { clock = Date.now(), dry = false } = {}) {
  const pricing = cfg.cost?.pricing ?? {};

  const ccSeries = parseCcStats(loadStats(dry), pricing);
  for (const d of ccSeries) {
    mem.insertUsage({ period_start: d.ts, period_end: d.ts + 864e5 - 1, source: 'cc-stats', tokens: d.byModel, usd: d.usd, raw_ref: 'stats-cache' });
  }

  let dropSeries = [];
  if (!dry) {
    for (const f of readDropFiles()) {
      if (f.error) continue;
      for (const d of f.series) mem.insertUsage({ period_start: d.ts, period_end: d.ts + 864e5 - 1, source: 'drop-file', usd: d.usd, raw_ref: f.name });
      dropSeries = dropSeries.concat(f.series);
      archive(f.full, f.name);
    }
  }

  // Drop-file $ (real provider bill) is authoritative when present; else cc-stats estimate.
  const series = dropSeries.length ? dropSeries.sort((a, b) => a.ts - b.ts) : ccSeries;
  if (series.length < 2) return { findings: [], series, baseline: null, latest: series.at(-1) ?? null };

  const baseline = summarize(series, cfg.cost?.baselineWindowDays ?? 14, true);
  mem.setBaseline({ metric: 'daily_usd', window_days: baseline.windowDays, baseline_value: baseline.meanUsd, stddev: baseline.stddevUsd });
  mem.setBaseline({ metric: 'daily_tokens', window_days: baseline.windowDays, baseline_value: baseline.meanTokens, stddev: baseline.stddevTokens });

  const latest = series.at(-1), prev = series.at(-2);
  const anomaly = detectAnomaly({ latest, prev, baseline, cfg });
  const findings = [];
  if (anomaly) {
    const d = anomaly.detail;
    findings.push({
      source: 'cost', kind: 'cost_anomaly', target_ref: 'cc', key: `cost:${latest.date}`,
      severity: anomaly.severity, timeCritical: anomaly.severity >= 4,
      title: `AI spend $${latest.usd} on ${latest.date}${d.ratio ? ` (${d.ratio}x baseline)` : ''} — ${anomaly.reasons[0]}`,
      detail: { ...d, reasons: anomaly.reasons, recommendation: 'check usage drivers; throttle sweep frequency or downshift model tiers if sustained' },
    });
  }
  return { findings, series, baseline, latest, anomaly };
}

export { round2 };
