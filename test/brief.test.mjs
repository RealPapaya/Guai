// renderBrief is pure (model → Markdown); lock its structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief } from '../core/render/brief.js';
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();

const model = () => ({
  date: 'Friday, Jun 12, 2026',
  headline: '1 need you · CI red on me/repo · 2 items',
  projName: new Map([[1, 'Demo']]),
  needsDecision: [{ kind: 'send_email', rationale: 'reply to investor', payload_json: {} }],
  priority: [{ title: 'CI failing: CI on main', kind: 'ci_failure', project_id: 1, detail_json: { url: 'http://x' } }],
  watching: [{ title: 'PR #1 stale', kind: 'stale_pr', project_id: 1, detail_json: {} }],
  byProject: [{ name: 'Demo', status: 'active', ci: 1, stale: 1, review: 0, total: 2 }],
  investigations: [],
  cost: { tracked: false },
  stats: { pushes: 0, since: 0 },
});

test('brief renders all populated sections with header + footer', () => {
  const md = renderBrief(model(), cfg);
  assert.match(md, /# Guai — Morning Brief · Friday, Jun 12, 2026/);
  assert.match(md, /> 1 need you · CI red on me\/repo · 2 items/);
  assert.match(md, /## ⚠ Needs your decision/);
  assert.match(md, /\/guai-confirm/);
  assert.match(md, /## 🔴 Priority/);
  assert.match(md, /Recommend: investigate the failing run/);
  assert.match(md, /\[link\]\(http:\/\/x\)/);
  assert.match(md, /## 📦 By project/);
  assert.match(md, /\*\*Demo\*\* _\(active\)_ — 1 CI · 1 stale/);
  assert.match(md, /## 👀 Watching/);
  assert.match(md, /Pushes since last brief: 0/);
});

test('empty brief says all clear', () => {
  const m = model();
  m.needsDecision = []; m.priority = []; m.watching = []; m.byProject = [];
  const md = renderBrief(m, cfg);
  assert.match(md, /All clear\. No items need your attention\./);
});
