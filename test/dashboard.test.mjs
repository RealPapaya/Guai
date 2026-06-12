// Dashboard is a pure snapshot→HTML render; verify structure, escaping, and the sparkline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory } from '../core/memory.js';
import { renderDashboard } from '../core/render/dashboard.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();

function seeded() {
  const mem = openMemory(':memory:');
  const pid = mem.upsertProject({ name: 'Demo', repos: ['me/repo'] });
  mem.upsertFinding({ source: 'dev', kind: 'ci_failure', target_ref: 'me/repo', key: 'ci:me/repo:main', title: 'CI failing <script>', severity: 3, gate_action: 'push', project_id: pid });
  mem.insertUsage({ period_start: Date.parse('2026-06-10T00:00:00Z'), period_end: 0, source: 'cc-stats', usd: 1.1 });
  mem.insertUsage({ period_start: Date.parse('2026-06-11T00:00:00Z'), period_end: 0, source: 'cc-stats', usd: 60.2 });
  mem.setBaseline({ metric: 'daily_usd', window_days: 14, baseline_value: 1.17, stddev: 0.1 });
  mem.enqueueAction({ kind: 'send_email', payload: { to: 'x' }, rationale: 'reply needed' });
  return mem;
}

test('renders a full HTML document with all sections', () => {
  const mem = seeded();
  const html = renderDashboard(mem.snapshot(), cfg);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Guai — Chief of Staff/);
  assert.match(html, /💰 Cost/);
  assert.match(html, /📦 Projects/);
  assert.match(html, /Awaiting your decision/);
  assert.match(html, /Open findings/);
  assert.match(html, /Demo/);
  assert.match(html, /send_email/);
  mem.close();
});

test('cost sparkline appears when there is usage data', () => {
  const mem = seeded();
  const html = renderDashboard(mem.snapshot(), cfg);
  assert.match(html, /<svg /);
  assert.match(html, /~\$60\.2/);
  mem.close();
});

test('finding titles are HTML-escaped (no injection)', () => {
  const mem = seeded();
  const html = renderDashboard(mem.snapshot(), cfg);
  assert.match(html, /CI failing &lt;script&gt;/);
  assert.ok(!html.includes('CI failing <script>'), 'raw script tag must not appear');
  mem.close();
});

test('empty DB still renders without throwing', () => {
  const mem = openMemory(':memory:');
  assert.doesNotThrow(() => renderDashboard(mem.snapshot(), cfg));
  mem.close();
});
