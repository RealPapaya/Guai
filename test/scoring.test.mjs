// Scoring + feature extraction (pure). Validates the math the gate relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priority, ev, onActiveProject, deadlineProximityBoost,
  isWorsening, isCrossDomain, timesAlreadySurfaced,
} from '../core/scoring.js';
import { fingerprint } from '../core/fingerprint.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();
const CLOCK = 1_700_000_000_000;
const ctx = () => ({ projects: [{ id: 1, name: 'P', repos_json: ['me/repo'] }], openFindings: [] });

test('onActiveProject matches by repo prefix and by id', () => {
  assert.equal(onActiveProject({ target_ref: 'me/repo#12' }, ctx()), true);
  assert.equal(onActiveProject({ project_id: 1 }, ctx()), true);
  assert.equal(onActiveProject({ target_ref: 'someone/else' }, ctx()), false);
});

test('deadlineProximityBoost ramps 0→1 over the last week', () => {
  assert.equal(deadlineProximityBoost({ deadline: CLOCK - 1 }, CLOCK), 1); // overdue
  assert.equal(deadlineProximityBoost({ deadline: CLOCK + 8 * 864e5 }, CLOCK), 0); // >1wk
  assert.ok(Math.abs(deadlineProximityBoost({ deadline: CLOCK + 3.5 * 864e5 }, CLOCK) - 0.5) < 0.01);
  assert.equal(deadlineProximityBoost({}, CLOCK), 0); // no deadline
});

test('priority adds project + deadline + trend, subtracts seen-decay', () => {
  const f = { source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', severity: 3, key: 'ci:me/repo:main' };
  // fresh, on project: 3 + project(2) = 5
  assert.equal(priority(f, ctx(), cfg, CLOCK), 5);

  // already surfaced twice → seenDecay reduces it
  const c2 = ctx();
  c2.openFindings = [{ fingerprint: fingerprint(f), severity: 3, times_surfaced: 2, source: 'dev', target_ref: 'me/repo' }];
  assert.equal(priority(f, c2, cfg, CLOCK), 5 - cfg.gate.weights.seenDecay * 2);
});

test('ev = impact(kind) - actionCost', () => {
  assert.equal(ev({ kind: 'ci_failure' }, cfg), cfg.impactWeights.ci_failure);
  assert.equal(ev({ kind: 'cost_anomaly', actionCost: 1 }, cfg), cfg.impactWeights.cost_anomaly - 1);
  assert.equal(ev({ kind: 'fyi' }, cfg), 0);
});

test('isWorsening detects severity increase vs prior open finding', () => {
  const f = { source: 'dev', kind: 'stale_pr', target_ref: 'me/repo', severity: 2, key: 'pr:me/repo#1' };
  const c = ctx();
  c.openFindings = [{ fingerprint: fingerprint(f), severity: 1, source: 'dev', target_ref: 'me/repo' }];
  assert.equal(isWorsening(f, c), true);
  assert.equal(isWorsening({ ...f, severity: 1 }, c), false);
});

test('isCrossDomain true only when >1 source touches the same target', () => {
  const c = ctx();
  c.openFindings = [{ source: 'cost', target_ref: 'me/repo', project_id: 1, fingerprint: 'z', severity: 2 }];
  assert.equal(isCrossDomain({ source: 'dev', target_ref: 'me/repo' }, c), true);
  assert.equal(isCrossDomain({ source: 'cost', target_ref: 'me/repo' }, c), false); // same single source
});

test('timesAlreadySurfaced reads the prior finding', () => {
  const f = { source: 'dev', kind: 'stale_pr', target_ref: 'me/repo', key: 'pr:me/repo#1' };
  const c = ctx();
  c.openFindings = [{ fingerprint: fingerprint(f), times_surfaced: 3, source: 'dev', target_ref: 'me/repo' }];
  assert.equal(timesAlreadySurfaced(f, c), 3);
});
