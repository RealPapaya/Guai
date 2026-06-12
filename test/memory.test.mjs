// M0 verification: schema migrates, findings round-trip + dedupe, run cursor works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory, fingerprint } from '../core/memory.js';

const mem = () => openMemory(':memory:');

test('schema migrates and meta is readable', () => {
  const m = mem();
  assert.equal(m.getMeta('schema_version'), '1');
  m.setMeta('hello', 'world');
  assert.equal(m.getMeta('hello'), 'world');
  m.close();
});

test('finding inserts then dedupes on fingerprint (bumps last_seen, no duplicate)', () => {
  const m = mem();
  // A stable `key` is what identifies a recurring signal; the title may vary.
  const f = { source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', key: 'ci:me/repo:main', title: 'CI red on main', severity: 3 };

  const a = m.upsertFinding(f);
  assert.equal(a.isNew, true);

  const b = m.upsertFinding({ ...f, title: 'CI red on main (still)' });
  assert.equal(b.isNew, false, 'same fingerprint must update, not duplicate');
  assert.equal(b.id, a.id);

  const open = m.openFindings();
  assert.equal(open.length, 1, 'exactly one open finding for a repeated signal');
  assert.equal(open[0].title, 'CI red on main (still)');
  m.close();
});

test('distinct signals get distinct fingerprints', () => {
  const m = mem();
  m.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'me/repo', title: 'PR #1 stale', key: 'pr-1' });
  m.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'me/repo', title: 'PR #2 stale', key: 'pr-2' });
  assert.equal(m.openFindings().length, 2);
  m.close();
});

test('resolved finding does not block a fresh recurrence', () => {
  const m = mem();
  const f = { source: 'cost', kind: 'cost_anomaly', target_ref: 'cc', title: 'spike', key: 'd1' };
  const { id } = m.upsertFinding(f);
  m.resolveFinding(id);
  const again = m.upsertFinding(f);
  assert.equal(again.isNew, true, 'resolved finding should not dedupe-block a new one');
  m.close();
});

test('action queue: enqueue → pending → decide', () => {
  const m = mem();
  const id = m.enqueueAction({ kind: 'send_email', payload: { to: 'x@y.z', body: 'hi' }, rationale: 'reply needed' });
  let pending = m.pendingActions();
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].payload_json, { to: 'x@y.z', body: 'hi' });
  m.decideAction(id, 'executed', { ok: true });
  assert.equal(m.pendingActions().length, 0);
  m.close();
});

test('expired actions are filtered out of pending', () => {
  const m = mem();
  m.enqueueAction({ kind: 'send_email', payload: {}, ttlMs: -1 }); // already expired
  assert.equal(m.pendingActions().length, 0);
  m.close();
});

test('run cursor advances via run_log', () => {
  const m = mem();
  assert.equal(m.lastRunEndedAt(), 0);
  const r = m.startRun({ trigger: 'manual' });
  m.endRun(r, { counts: { findings: 3 } });
  assert.ok(m.lastRunEndedAt() > 0);
  m.close();
});

test('push rate-limit primitives read the comms log', () => {
  const m = mem();
  const fp = fingerprint({ source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', title: 't' });
  assert.equal(m.pushesSince(0), 0);
  m.logComms({ kind: 'push', fingerprint: fp, text: 'ping' });
  assert.equal(m.pushesSince(0), 1);
  assert.ok(m.lastPushForFingerprint(fp) > 0);
  m.close();
});

test('loadRunContext returns the full startup bundle', () => {
  const m = mem();
  m.upsertProject({ name: 'Guai', repos: ['me/guai'] });
  m.addWatchTarget({ kind: 'github_repo', ref: 'me/guai' });
  const ctx = m.loadRunContext();
  assert.equal(ctx.projects.length, 1);
  assert.deepEqual(ctx.projects[0].repos_json, ['me/guai']);
  assert.equal(ctx.watchTargets.length, 1);
  assert.ok('openFindings' in ctx && 'pendingActions' in ctx);
  m.close();
});

test('snapshot is JSON-serializable and includes core tables', () => {
  const m = mem();
  m.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'r', title: 't', key: 'k' });
  const snap = m.snapshot();
  assert.doesNotThrow(() => JSON.stringify(snap));
  assert.ok(Array.isArray(snap.findings) && snap.findings.length === 1);
  m.close();
});
