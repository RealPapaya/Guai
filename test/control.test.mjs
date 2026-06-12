// Config validation + per-domain sweep gating — the surface the desktop GUI drives.
// Pure validation is unit-tested directly; gating runs a dry sweep over an in-memory DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory } from '../core/memory.js';
import { runSweep } from '../core/sweep.js';
import {
  loadConfig, validateConfig, monitorEnabled, MONITOR_DOMAINS,
  UI_LANGUAGES, SECRET_NAMES, secretStatus, setFileSecret,
} from '../core/config.js';

const base = loadConfig();

// ---- validateConfig ---------------------------------------------------------

test('validateConfig accepts the shipped config', () => {
  const { ok, errors } = validateConfig(base);
  assert.equal(ok, true, errors.join('; '));
});

test('validateConfig rejects a non-object', () => {
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig(42).ok, false);
});

test('validateConfig rejects a non-boolean monitor flag', () => {
  const { ok, errors } = validateConfig({ ...base, monitors: { ...base.monitors, dev: 'yes' } });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('monitors.dev')));
});

test('validateConfig rejects out-of-range push + gate values', () => {
  assert.equal(validateConfig({ ...base, push: { ...base.push, maxPerDay: -1 } }).ok, false);
  assert.equal(validateConfig({ ...base, gate: { ...base.gate, pushThreshold: 999 } }).ok, false);
  assert.equal(validateConfig({ ...base, schedule: { ...base.schedule, dailyBriefHour: 24 } }).ok, false);
});

test('validateConfig rejects malformed github.repos entries', () => {
  assert.equal(validateConfig({ ...base, github: { ...base.github, repos: ['ok/name', 'bad'] } }).ok, false);
  assert.equal(validateConfig({ ...base, github: { ...base.github, repos: ['owner/name'] } }).ok, true);
});

test('validateConfig accepts a known ui.language, rejects an unknown one', () => {
  assert.equal(validateConfig({ ...base, ui: { language: 'zh-TW' } }).ok, true);
  assert.equal(validateConfig({ ...base, ui: { language: 'en' } }).ok, true);
  const bad = validateConfig({ ...base, ui: { language: 'fr' } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('ui.language')));
  assert.equal(validateConfig({ ...base, ui: 'zh' }).ok, false);
  assert.deepEqual(UI_LANGUAGES, ['en', 'zh-TW']);
});

test('validateConfig accepts known usage presentation preferences', () => {
  assert.equal(validateConfig({ ...base, ui: { ...base.ui, usage: {
    chartType: 'line', lineKind: 'tokens', rangeDays: 7, provider: 'codex', scope: 'month',
  } } }).ok, true);
  assert.equal(validateConfig({ ...base, ui: { ...base.ui, usage: { chartType: 'pie' } } }).ok, false);
  assert.equal(validateConfig({ ...base, ui: { ...base.ui, usage: { scope: 'year' } } }).ok, false);
});

// ---- secrets status (never exposes a raw value) -----------------------------

test('SECRET_NAMES covers the manageable token accounts', () => {
  assert.deepEqual(SECRET_NAMES, ['GITHUB_TOKEN', 'LINE_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GUAI_SIDECAR_TOKEN']);
});

test('secretStatus reports the env source and exposes no value', () => {
  const NAME = 'LINE_TOKEN';
  const had = Object.prototype.hasOwnProperty.call(process.env, NAME);
  const prev = process.env[NAME];
  try {
    process.env[NAME] = 'super-secret-token';
    const st = secretStatus(NAME);
    assert.deepEqual(st, { set: true, source: 'env' }); // exactly {set,source}, no token field
  } finally {
    if (had) process.env[NAME] = prev; else delete process.env[NAME];
  }
});

test('setFileSecret rejects unknown names', () => {
  assert.throws(() => setFileSecret('SOME_OTHER_KEY', 'x'), /Unknown secret/);
});

// ---- monitorEnabled defaults ------------------------------------------------

test('monitorEnabled: only an explicit false disables; absent ⇒ enabled', () => {
  assert.equal(monitorEnabled({ monitors: { dev: false } }, 'dev'), false);
  assert.equal(monitorEnabled({ monitors: { dev: true } }, 'dev'), true);
  assert.equal(monitorEnabled({ monitors: {} }, 'dev'), true);   // absent ⇒ on
  assert.equal(monitorEnabled({}, 'dev'), true);                  // no block ⇒ on
  assert.equal(MONITOR_DOMAINS.length, 4);
});

// ---- per-domain gating in the sweep -----------------------------------------

const sweepWith = (monitors) => {
  const mem = openMemory(':memory:');
  return runSweep(mem, { ...base, monitors }, { repos: [], dry: true, trigger: 'test' })
    .finally(() => mem.close());
};

test('all domains on: dry sweep produces dev + cost findings, nothing skipped', async () => {
  const res = await sweepWith({ dev: true, cost: true, email: true, calendar: true });
  assert.deepEqual(res.skipped, []);
  assert.ok(res.decided.some((f) => f.source === 'dev'));
  assert.ok(res.decided.some((f) => f.source === 'cost'));
});

test('cost off: cost ingest is skipped and reported', async () => {
  const res = await sweepWith({ dev: true, cost: false, email: true, calendar: true });
  assert.deepEqual(res.skipped, ['cost']);
  assert.equal(res.decided.some((f) => f.source === 'cost'), false);
  assert.ok(res.decided.some((f) => f.source === 'dev'));
});

test('dev off: dev ingest is skipped and reported', async () => {
  const res = await sweepWith({ dev: false, cost: true, email: true, calendar: true });
  assert.deepEqual(res.skipped, ['dev']);
  assert.equal(res.decided.some((f) => f.source === 'dev'), false);
});

test('both deterministic domains off: nothing ingested', async () => {
  const res = await sweepWith({ dev: false, cost: false, email: true, calendar: true });
  assert.deepEqual(res.skipped.sort(), ['cost', 'dev']);
  assert.equal(res.decided.length, 0);
});
