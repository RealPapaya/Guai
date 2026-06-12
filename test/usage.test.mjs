import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseClaudeFiles, parseCodexFile } from '../core/usage.js';
import { openMemory } from '../core/memory.js';

const jsonl = (name, rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'guai-usage-'));
  const file = join(dir, name);
  writeFileSync(file, rows.map((x) => JSON.stringify(x)).join('\n'));
  return file;
};

test('Claude parser deduplicates repeated streamed assistant records', () => {
  const usage = { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 4 };
  const file = jsonl('claude.jsonl', [
    { type: 'user', sessionId: 's1', uuid: 'u1', timestamp: '2026-06-12T00:00:00Z', cwd: 'C:\\work\\p', message: { content: 'Implement usage' } },
    { type: 'assistant', sessionId: 's1', uuid: 'a1', requestId: 'r1', timestamp: '2026-06-12T00:00:01Z', message: { id: 'm1', model: 'opus', usage } },
    { type: 'assistant', sessionId: 's1', uuid: 'a2', requestId: 'r1', timestamp: '2026-06-12T00:00:02Z', message: { id: 'm1', model: 'opus', usage } },
  ]);
  const [s] = parseClaudeFiles([file]);
  assert.equal(s.total_tokens, 39);
  assert.equal(s.turns[0].total_tokens, 39);
  assert.equal(s.title, 'Implement usage');
});

test('Codex parser turns cumulative token counts into per-turn deltas', () => {
  const event = (at, total) => ({ timestamp: at, type: 'event_msg', payload: {
    type: 'token_count', info: { total_token_usage: total }, rate_limits: {
      plan_type: 'plus', primary: { used_percent: 20, window_minutes: 300, resets_at: 2000000000 },
    },
  } });
  const file = jsonl('codex.jsonl', [
    { timestamp: '2026-06-12T00:00:00Z', type: 'session_meta', payload: { id: 'c1', cwd: 'C:\\work\\p' } },
    { timestamp: '2026-06-12T00:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    { timestamp: '2026-06-12T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: '<environment_context>hidden</environment_context>' }] } },
    { timestamp: '2026-06-12T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Build the usage dashboard' }] } },
    event('2026-06-12T00:00:02Z', { input_tokens: 10, output_tokens: 2, total_tokens: 12 }),
    { timestamp: '2026-06-12T00:01:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't2' } },
    event('2026-06-12T00:01:01Z', { input_tokens: 25, output_tokens: 5, total_tokens: 30 }),
  ]);
  const s = parseCodexFile(file);
  assert.equal(s.total_tokens, 30);
  assert.equal(s.turns[0].total_tokens, 12);
  assert.equal(s.turns[1].total_tokens, 18);
  assert.equal(s.title, 'Build the usage dashboard');
  assert.equal(s.quota[0].resets_at, 2000000000000);
  assert.equal(s.plan_type, 'plus');
});

test('usage memory stores project-linked sessions, turns, accounts, and quota', () => {
  const m = openMemory(':memory:');
  m.upsertProject({ name: 'P' });
  const p = m.projectByName('P');
  m.setProjectRoot({ root_path: 'c:\\work\\p', project_id: p.id, provider: 'codex' });
  m.upsertUsageAccount({ provider: 'codex', plan_type: 'plus', status: 'connected' });
  m.upsertUsageSession({ provider: 'codex', session_id: 's', project_id: p.id, title: 'Task', total_tokens: 42, updated_at: 10 });
  m.replaceUsageTurns('codex', 's', [{ turn_id: 't', title: 'Turn', total_tokens: 42 }]);
  m.addQuotaSnapshot({ provider: 'codex', window_name: 'primary', used_percent: 33, captured_at: 10 });
  assert.equal(m.usageSummary().totals[0].total_tokens, 42);
  assert.equal(m.usageProjects({ since: 10 })[0].total_tokens, 42);
  assert.equal(m.usageProjects({ since: 11 }).length, 0);
  assert.equal(m.usageSession('codex', 's').turns[0].title, 'Turn');
  assert.equal(m.latestQuota('codex')[0].used_percent, 33);
  m.close();
});
