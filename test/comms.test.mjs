// Push policy: quiet hours, caps, per-fingerprint cooldown, and atomic selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory } from '../core/memory.js';
import { inQuietHours, canPushNow, selectPushes, pushText } from '../core/comms.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();
const noon = new Date('2026-06-12T12:00:00').getTime();   // local noon — outside quiet hours
const night = new Date('2026-06-12T23:30:00').getTime();  // inside quiet hours (21–7)

const pushFinding = (mem, key = 'ci:me/repo:main') => {
  const { id } = mem.upsertFinding({ source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', key, title: 'CI red', severity: 3, gate_action: 'push' });
  return id;
};

test('inQuietHours respects a wrap-around window', () => {
  assert.equal(inQuietHours(night, cfg), true);
  assert.equal(inQuietHours(noon, cfg), false);
});

test('pushText is prefixed, action-first, and length-capped', () => {
  const t = pushText({ title: 'x'.repeat(500) }, cfg);
  assert.ok(t.startsWith('Guai: '));
  assert.ok(t.length <= cfg.push.maxChars);
});

test('selectPushes sends an eligible push and logs it', () => {
  const mem = openMemory(':memory:');
  pushFinding(mem);
  const { send, deferred } = selectPushes(mem, cfg, noon);
  assert.equal(send.length, 1);
  assert.equal(deferred.length, 0);
  assert.equal(mem.pushesSince(0), 1, 'push must be recorded in comms_log');
  mem.close();
});

test('a second push for the same fingerprint is blocked by cooldown', () => {
  const mem = openMemory(':memory:');
  pushFinding(mem);
  selectPushes(mem, cfg, noon);            // first send
  mem.upsertFinding({ source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', key: 'ci:me/repo:main', title: 'CI still red', severity: 3, gate_action: 'push' });
  const { send, deferred } = selectPushes(mem, cfg, noon + 60e3); // 1 min later
  assert.equal(send.length, 0);
  assert.equal(deferred[0].reason, 'fingerprint cooldown');
  mem.close();
});

test('quiet hours blocks all pushes', () => {
  const mem = openMemory(':memory:');
  pushFinding(mem);
  const { send, deferred } = selectPushes(mem, cfg, night);
  assert.equal(send.length, 0);
  assert.equal(deferred[0].reason, 'quiet hours');
  mem.close();
});

test('hourly cap defers once exceeded', () => {
  const mem = openMemory(':memory:');
  for (let i = 0; i < cfg.push.maxPerHour; i++) {
    mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'me/repo', key: `pr:${i}`, title: `PR ${i}`, severity: 3, gate_action: 'push' });
  }
  const first = selectPushes(mem, cfg, noon);
  assert.equal(first.send.length, cfg.push.maxPerHour);
  mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'me/repo', key: 'pr:extra', title: 'one more', severity: 3, gate_action: 'push' });
  const second = selectPushes(mem, cfg, noon + 5 * 60e3);
  assert.equal(second.send.length, 0);
  assert.equal(second.deferred[0].reason, 'hourly cap');
  mem.close();
});
