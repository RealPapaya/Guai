// Merge/dedupe across worker batches + finding validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAndDedupe } from '../workflows/lib/collect.js';
import { validateFindings, validateFinding } from '../workflows/lib/schemas.js';

test('mergeAndDedupe collapses same signal, keeping max severity + OR-ing flags', () => {
  const a = { source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', key: 'ci:me/repo:main', title: 'CI red', severity: 2, detail: { url: 'u' } };
  const b = { source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', key: 'ci:me/repo:main', title: 'CI still red', severity: 3, timeCritical: true, detail: { runId: 9 } };
  const out = mergeAndDedupe([[a], [b]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 3);
  assert.equal(out[0].timeCritical, true);
  assert.deepEqual(out[0].detail, { url: 'u', runId: 9 });
});

test('distinct signals are preserved', () => {
  const out = mergeAndDedupe([[
    { source: 'dev', kind: 'stale_pr', target_ref: 'r', key: 'pr-1', title: 'a' },
    { source: 'inbox', kind: 'needs_reply', target_ref: 't', key: 'th-1', title: 'b' },
  ]]);
  assert.equal(out.length, 2);
});

test('validateFinding rejects bad source / missing fields / bad severity', () => {
  assert.equal(validateFinding({ source: 'dev', kind: 'ci_failure', title: 'x' }).ok, true);
  assert.equal(validateFinding({ source: 'nope', kind: 'k', title: 'x' }).ok, false);
  assert.equal(validateFinding({ source: 'dev', title: 'x' }).ok, false);
  assert.equal(validateFinding({ source: 'dev', kind: 'k', title: 'x', severity: 9 }).ok, false);
});

test('validateFindings partitions valid/invalid', () => {
  const { valid, invalid } = validateFindings([
    { source: 'inbox', kind: 'needs_reply', title: 'ok' },
    { source: 'bogus', kind: 'k', title: 'bad' },
  ]);
  assert.equal(valid.length, 1);
  assert.equal(invalid.length, 1);
  assert.ok(invalid[0].errors.length);
});
