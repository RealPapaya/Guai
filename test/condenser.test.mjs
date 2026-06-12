// Condenser collapses aged resolved findings + old run-log into history_digest, then deletes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory } from '../core/memory.js';
import { maybeCondense, needsLlmCondense } from '../core/condenser.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();
const DAY = 864e5;
const now = 1_800_000_000_000;

test('aged resolved findings are condensed and deleted; recent ones survive', () => {
  const mem = openMemory(':memory:');
  const oldF = mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'r', key: 'old', title: 'old' }).id;
  const newF = mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'r', key: 'new', title: 'new' }).id;
  mem.resolveFinding(oldF, now - 30 * DAY); // older than 14d cutoff
  mem.resolveFinding(newF, now - 1 * DAY);  // recent

  const res = maybeCondense(mem, cfg, now);
  assert.equal(res.condensedFindings, 1);
  assert.equal(mem.getFinding(oldF), undefined, 'aged resolved finding should be deleted');
  assert.ok(mem.getFinding(newF), 'recent resolved finding should survive');
  assert.ok(mem.latestHistoryDigest(), 'a history_digest summary should be recorded');
  mem.close();
});

test('old run-log entries are condensed', () => {
  const mem = openMemory(':memory:');
  mem.db.prepare(`INSERT INTO run_log(trigger,started_at,ended_at,ok) VALUES('cron',?,?,1)`).run(now - 40 * DAY, now - 40 * DAY);
  const res = maybeCondense(mem, cfg, now);
  assert.equal(res.condensedRuns, 1);
  mem.close();
});

test('needsLlmCondense flags an oversized working set', () => {
  const mem = openMemory(':memory:');
  const small = needsLlmCondense(mem, cfg);
  assert.equal(small, false);
  const tiny = { ...cfg, condenser: { ...cfg.condenser, maxOpenContextItems: 0 } };
  mem.upsertFinding({ source: 'dev', kind: 'stale_pr', target_ref: 'r', key: 'x', title: 't' });
  assert.equal(needsLlmCondense(mem, tiny), true);
  mem.close();
});
