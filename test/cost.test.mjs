// Cost ingest parsers + baseline + anomaly detection (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCcStats, parseDropContent, summarize, detectAnomaly } from '../core/ingest/cost.js';
import { loadConfig, paths } from '../core/config.js';

const cfg = loadConfig();
const pricing = cfg.cost.pricing;
const stats = JSON.parse(readFileSync(join(paths.fixtures, 'stats-cache.json'), 'utf8'));

test('parseCcStats sums tokens and estimates USD per day', () => {
  const series = parseCcStats(stats, pricing);
  assert.equal(series.length, 8);
  const first = series[0];
  assert.equal(first.tokens, 190000);
  // 190000 sonnet @ $6/Mtok ≈ $1.14
  assert.ok(Math.abs(first.usd - 1.14) < 0.01);
  const spike = series.at(-1);
  assert.equal(spike.tokens, 2120000);
  // 2M opus @30 + 120k haiku @1.5 ≈ 60.18
  assert.ok(spike.usd > 59 && spike.usd < 61);
});

test('summarize computes baseline excluding the latest (spike) day', () => {
  const series = parseCcStats(stats, pricing);
  const b = summarize(series, 14, true);
  assert.equal(b.count, 7);
  assert.ok(b.meanUsd > 1 && b.meanUsd < 1.4, 'baseline ~ $1.1-1.3/day');
});

test('detectAnomaly flags the spike as severity 4 (over budget)', () => {
  const series = parseCcStats(stats, pricing);
  const baseline = summarize(series, 14, true);
  const a = detectAnomaly({ latest: series.at(-1), prev: series.at(-2), baseline, cfg });
  assert.ok(a, 'spike should be an anomaly');
  assert.equal(a.severity, 4);
  assert.ok(a.reasons.length >= 1);
  assert.ok(a.detail.projMonthly > cfg.cost.monthlyBudgetUsd);
});

test('detectAnomaly returns null for a normal day', () => {
  const series = parseCcStats(stats, pricing).slice(0, -1); // drop the spike
  const baseline = summarize(series, 14, true);
  const a = detectAnomaly({ latest: series.at(-1), prev: series.at(-2), baseline, cfg });
  assert.equal(a, null);
});

test('detectAnomaly needs ≥3 baseline days', () => {
  const a = detectAnomaly({ latest: { usd: 99, tokens: 1 }, prev: null, baseline: { count: 1 }, cfg });
  assert.equal(a, null);
});

test('parseDropContent handles CSV and JSON', () => {
  const csv = parseDropContent('date,usd,tokens\n2026-06-01,12.5,100000\n2026-06-02,9.0,80000', 'bill.csv');
  assert.equal(csv.length, 2);
  assert.equal(csv[0].usd, 12.5);
  assert.equal(csv[0].source, 'drop-file');
  const json = parseDropContent(JSON.stringify([{ date: '2026-06-01', usd: 3.3 }]), 'bill.json');
  assert.equal(json[0].usd, 3.3);
});
