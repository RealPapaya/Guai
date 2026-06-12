// Deterministic weekly review: trends + housekeeping. The /guai-review skill runs this,
// then layers Sonnet condensation/narrative on top.
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { maybeCondense } from '../core/condenser.js';
import { calibrate } from '../core/tuning.js';

const WEEK = 7 * 864e5;
const cfg = loadConfig();
const mem = openMemory(paths.db);
const now = Date.now();
const weekAgo = now - WEEK;

const snap = mem.snapshot();
const opened = snap.findings.filter((f) => f.first_seen_at >= weekAgo);
const resolved = snap.findings.filter((f) => f.resolved_at && f.resolved_at >= weekAgo);
const cost = snap.cost_usage.filter((u) => u.period_start >= weekAgo);
const weekUsd = Math.round(cost.reduce((s, u) => s + u.usd, 0) * 100) / 100;

const byProject = {};
for (const p of mem.activeProjects()) {
  byProject[p.name] = mem.openFindings().filter((f) => f.project_id === p.id).length;
}

const condensed = maybeCondense(mem, cfg, now);
const { suggestions } = calibrate(mem, cfg);

console.log('Guai — Weekly Review');
console.log('====================');
console.log(`Findings opened this week : ${opened.length}`);
console.log(`Findings resolved         : ${resolved.length}`);
console.log(`Open by project           : ${JSON.stringify(byProject)}`);
console.log(`Estimated AI spend (7d)    : ~$${weekUsd}`);
console.log(`Condensed                  : ${condensed.condensedFindings} findings, ${condensed.condensedRuns} runs`);
console.log(`Tuning suggestions         : ${suggestions.length}`);
for (const s of suggestions) console.log(`   • [${s.kind}] ${s.change}`);
mem.close();
