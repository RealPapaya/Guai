// L5 calibration: a kind that's repeatedly dismissed yields a "raise threshold" suggestion;
// a kind that's consistently acted-on is affirmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory } from '../core/memory.js';
import { calibrate } from '../core/tuning.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();

test('repeatedly dismissed pushes suggest raising that kind threshold', () => {
  const mem = openMemory(':memory:');
  const { id } = mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'r', key: 'k', title: 'noisy', gate_action: 'push' });
  for (let i = 0; i < 4; i++) {
    const cid = mem.logComms({ kind: 'push', finding_id: id, fingerprint: 'k', text: 'ping' });
    mem.recordResponse(cid, 'dismiss');
  }
  const { suggestions, byKind } = calibrate(mem, cfg);
  assert.equal(byKind.stale_pr.pushes, 4);
  assert.equal(byKind.stale_pr.dismiss, 4);
  assert.ok(suggestions.find((s) => s.kind === 'stale_pr' && /raise/i.test(s.change)));
  mem.close();
});

test('consistently acted-on pushes are affirmed, not flagged for raising', () => {
  const mem = openMemory(':memory:');
  const { id } = mem.upsertFinding({ source: 'dev', kind: 'ci_failure', target_ref: 'r', key: 'c', title: 'ci', gate_action: 'push' });
  for (let i = 0; i < 4; i++) {
    const cid = mem.logComms({ kind: 'push', finding_id: id, fingerprint: 'c', text: 'ping' });
    mem.recordResponse(cid, 'act');
  }
  const { suggestions } = calibrate(mem, cfg);
  const s = suggestions.find((x) => x.kind === 'ci_failure');
  assert.ok(s && /valuable/i.test(s.change));
  mem.close();
});

test('fewer than 3 data points yields no suggestion', () => {
  const mem = openMemory(':memory:');
  const { id } = mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'r', key: 'k', title: 't', gate_action: 'push' });
  const cid = mem.logComms({ kind: 'push', finding_id: id, fingerprint: 'k', text: 'p' });
  mem.recordResponse(cid, 'dismiss');
  assert.equal(calibrate(mem, cfg).suggestions.length, 0);
  mem.close();
});
