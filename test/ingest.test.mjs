// GitHub normalizers against fixtures (no network). Fixture dates are anchored to
// CLOCK = 2023-11-14T00:00:00Z so severities are deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRepo } from '../core/ingest/github.js';
import { loadConfig, paths } from '../core/config.js';

const cfg = loadConfig();
const CLOCK = Date.parse('2023-11-14T00:00:00Z');
const fx = (n) => JSON.parse(readFileSync(join(paths.fixtures, n), 'utf8'));

const result = normalizeRepo(
  {
    repo: 'me/repo',
    repoInfo: fx('github-repo.json'),
    pulls: fx('github-pulls.json'),
    runs: fx('github-runs.json').workflow_runs,
  },
  cfg, CLOCK
);
const byKey = Object.fromEntries(result.findings.map((f) => [f.key, f]));

test('produces exactly the expected finding set (healthy PR #3 omitted)', () => {
  const keys = result.findings.map((f) => f.key).sort();
  assert.deepEqual(keys, [
    'ci:me/repo:main:CI',
    'pr:me/repo#1',
    'pr:me/repo#2',
    'pr:me/repo#4',
  ]);
});

test('stale PR severity scales with staleness', () => {
  assert.equal(byKey['pr:me/repo#1'].kind, 'stale_pr');
  assert.equal(byKey['pr:me/repo#1'].severity, 3); // 20d / 7 → 1+2 = 3
});

test('PR awaiting review becomes review_backlog', () => {
  assert.equal(byKey['pr:me/repo#2'].kind, 'review_backlog');
  assert.equal(byKey['pr:me/repo#2'].severity, 2);
  assert.equal(byKey['pr:me/repo#2'].detail.reviewers, 1);
});

test('old draft is a low-severity stale_pr', () => {
  assert.equal(byKey['pr:me/repo#4'].kind, 'stale_pr');
  assert.equal(byKey['pr:me/repo#4'].severity, 1);
});

test('CI failure: latest failing run on default branch, time-critical', () => {
  const ci = byKey['ci:me/repo:main:CI'];
  assert.equal(ci.kind, 'ci_failure');
  assert.equal(ci.timeCritical, true);
  assert.equal(ci.severity, 3);
  assert.equal(ci.detail.headSha, 'a1b2c3d');
});

test('passing workflow (Lint) produces no finding', () => {
  assert.equal(result.findings.some((f) => f.key.includes(':Lint')), false);
});

test('stats summarize repo activity', () => {
  assert.equal(result.stats.openPRs, 4);
  assert.equal(result.stats.ciFailing, 1);
});
