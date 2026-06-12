// The most important test in the system: the decision-gate truth table.
// Pure functions only — no DB. Uses the REAL config so thresholds are validated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../core/gate.js';
import { fingerprint } from '../core/fingerprint.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();
const CLOCK = 1_700_000_000_000;

// Active project P owns repo me/repo. Default: no prior open findings.
const ctxBase = () => ({
  projects: [{ id: 1, name: 'P', repos_json: ['me/repo'] }],
  openFindings: [],
});

const F = (over) => ({ source: 'dev', target_ref: 'me/repo', title: 't', severity: 0, ...over });

test('IGNORE — sev0 noise off any active project', () => {
  const d = decide(F({ kind: 'fyi', severity: 0, target_ref: 'other/x' }), ctxBase(), cfg, CLOCK);
  assert.equal(d.action, 'ignore');
});

test('STORE — passes attention but EV at/below floor', () => {
  // fyi has impact 0 → EV 0 ≤ floor; but it IS on an active project so not ignored.
  const d = decide(F({ kind: 'fyi', severity: 1 }), ctxBase(), cfg, CLOCK);
  assert.equal(d.action, 'store');
});

test('DIGEST — routine stale PR on active project, not urgent', () => {
  const d = decide(F({ kind: 'stale_pr', severity: 1, key: 'pr:me/repo#1' }), ctxBase(), cfg, CLOCK);
  assert.equal(d.action, 'digest');
  assert.ok(d.priority < cfg.gate.pushThreshold);
});

test('PUSH — fresh CI failure on active project is high-priority & time-critical', () => {
  const d = decide(
    F({ kind: 'ci_failure', severity: 3, timeCritical: true, key: 'ci:me/repo:main' }),
    ctxBase(), cfg, CLOCK
  );
  assert.equal(d.action, 'push');
  assert.ok(d.priority >= cfg.gate.pushThreshold);
});

test('DIGEST not PUSH — same CI failure but on a repo we do not actively track', () => {
  const d = decide(
    F({ kind: 'ci_failure', severity: 3, timeCritical: true, target_ref: 'other/x', key: 'ci:other/x:main' }),
    ctxBase(), cfg, CLOCK
  );
  assert.equal(d.action, 'digest');
});

test('ESCALATE→chief — top severity warrants deep analysis', () => {
  const d = decide(F({ source: 'cost', kind: 'cost_anomaly', severity: 4, target_ref: 'cc' }), ctxBase(), cfg, CLOCK);
  assert.equal(d.action, 'escalate');
  assert.equal(d.to, 'chief');
});

test('ESCALATE→researcher — delegable for more signal (Q5 precedes Q3)', () => {
  const d = decide(
    F({ source: 'cost', kind: 'cost_anomaly', severity: 2, needsMoreSignal: true, target_ref: 'cc' }),
    ctxBase(), cfg, CLOCK
  );
  assert.equal(d.action, 'escalate');
  assert.equal(d.to, 'researcher');
});

test('ESCALATE — cross-domain: same project, trouble from two sources', () => {
  const ctx = ctxBase();
  ctx.openFindings = [{ source: 'cost', target_ref: 'me/repo', project_id: 1, fingerprint: 'x', severity: 2 }];
  const d = decide(F({ kind: 'review_backlog', severity: 2, project_id: 1, key: 'rb:me/repo' }), ctx, cfg, CLOCK);
  assert.equal(d.action, 'escalate');
  assert.equal(d.to, 'chief');
});

test('ANTI-NAG — already surfaced + stable demotes to store (no re-nagging)', () => {
  const f = F({ kind: 'stale_pr', severity: 1, key: 'pr:me/repo#7' });
  const ctx = ctxBase();
  ctx.openFindings = [{ fingerprint: fingerprint(f), severity: 1, status: 'surfaced', times_surfaced: 1, source: 'dev', target_ref: 'me/repo' }];
  const d = decide(f, ctx, cfg, CLOCK);
  assert.equal(d.action, 'store', 'a stable, already-surfaced item should not keep surfacing');
});

test('ANTI-NAG is overridden when the signal worsens', () => {
  const f = F({ kind: 'stale_pr', severity: 2, key: 'pr:me/repo#7' }); // sev rose 1 → 2
  const ctx = ctxBase();
  ctx.openFindings = [{ fingerprint: fingerprint(f), severity: 1, status: 'surfaced', times_surfaced: 1, source: 'dev', target_ref: 'me/repo' }];
  const d = decide(f, ctx, cfg, CLOCK);
  assert.notEqual(d.action, 'store', 'a worsening signal must escape the anti-nag store');
});

test('every action is one of the five and carries scores + a reason', () => {
  const d = decide(F({ kind: 'stale_pr', severity: 1, key: 'pr:me/repo#1' }), ctxBase(), cfg, CLOCK);
  assert.ok(['ignore', 'store', 'digest', 'push', 'escalate'].includes(d.action));
  assert.equal(typeof d.priority, 'number');
  assert.equal(typeof d.ev, 'number');
  assert.equal(typeof d.reason, 'string');
});
