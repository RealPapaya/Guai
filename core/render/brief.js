// Renders the executive morning brief from memory. buildBriefModel() reads state
// (deterministically, no LLM — in M2 the Opus chief replaces the prioritization);
// renderBrief() is a pure model→Markdown function (unit-testable).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../config.js';

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });

/** Always-actionable next step per finding kind. */
const RECOMMEND = {
  ci_failure: 'investigate the failing run and get the branch green',
  stale_pr: 'review, ping the author, or close it',
  review_backlog: 'assign a reviewer or review it now',
  needs_reply: 'reply or delegate',
  calendar_conflict: 'resolve the double-booking',
  cost_anomaly: 'check what drove the spike and throttle if needed',
  opportunity: 'evaluate and decide whether to pursue',
};
const recommend = (f) => RECOMMEND[f.kind] ?? 'review and decide';

export function buildBriefModel(mem, cfg, clock = Date.now()) {
  const since = mem.lastBriefTs();
  const projects = mem.activeProjects();
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  const items = mem.findingsForDigest(since);

  const priority = items.filter((f) => f.gate_action === 'push' || f.gate_action === 'escalate');
  const watching = items.filter((f) => f.gate_action === 'digest');
  const ciRepos = [...new Set(priority.filter((f) => f.kind === 'ci_failure').map((f) => f.target_ref))];

  // Group everything surfaced by project for the "By project" board.
  const byProject = projects.map((p) => {
    const fs = items.filter((f) => f.project_id === p.id);
    const count = (k) => fs.filter((f) => f.kind === k).length;
    return {
      name: p.name, status: p.status,
      ci: count('ci_failure'), stale: count('stale_pr'), review: count('review_backlog'),
      total: fs.length,
    };
  }).filter((p) => p.total > 0);

  const pending = mem.pendingActions();
  const investigations = mem.openInvestigations();

  // Cost line from real ingested usage (estimated $; tokens are the reliable metric).
  const cs = mem.costSummary();
  let cost = { tracked: false };
  if (cs.latest) {
    const usd = cs.latest.usd;
    const proj = Math.round(usd * 30 * 100) / 100;
    const vs = cs.baselineUsd != null ? ` vs $${cs.baselineUsd} baseline` : '';
    cost = { tracked: true, line: `~$${usd} latest day${vs} · ~$${proj}/mo projected (estimated)` };
  }
  const costWord = cost.tracked
    ? (cs.baselineUsd && cs.latest.usd > cs.baselineUsd * 1.5 ? 'spend ELEVATED' : 'spend nominal')
    : null;

  const headline = [
    pending.length ? `${pending.length} need you` : null,
    ciRepos.length ? `CI red on ${ciRepos.join(', ')}` : 'CI green',
    costWord,
    `${priority.length + watching.length} item${priority.length + watching.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  return {
    date: fmtDate(clock),
    headline,
    needsDecision: pending,
    priority, watching, byProject, investigations,
    projName,
    cost,
    stats: { pushes: mem.pushesSince(since), since },
  };
}

export function renderBrief(model, cfg) {
  const tpl = readFileSync(join(paths.templates, 'morning_brief.md.tmpl'), 'utf8');
  const proj = (id) => model.projName?.get?.(id) ?? 'Unassigned';
  const S = [];

  if (model.needsDecision.length) {
    S.push('## ⚠ Needs your decision');
    for (const a of model.needsDecision) {
      const p = a.payload_json ?? {};
      S.push(`- **${a.kind}** — ${a.rationale ?? p.summary ?? 'pending action'}  → approve with \`/guai-confirm\``);
    }
    S.push('');
  }

  if (model.priority.length) {
    S.push('## 🔴 Priority');
    for (const f of model.priority) {
      S.push(`- **${f.title}** _(${proj(f.project_id)})_ — Recommend: ${recommend(f)}.${f.detail_json?.url ? ` [link](${f.detail_json.url})` : ''}`);
    }
    S.push('');
  }

  if (model.byProject.length) {
    S.push('## 📦 By project');
    for (const p of model.byProject) {
      const bits = [p.ci && `${p.ci} CI`, p.review && `${p.review} awaiting review`, p.stale && `${p.stale} stale`]
        .filter(Boolean).join(' · ') || 'nominal';
      S.push(`- **${p.name}** _(${p.status})_ — ${bits}`);
    }
    S.push('');
  }

  S.push('## 💰 Cost');
  S.push(model.cost.tracked
    ? `- ${model.cost.line}`
    : '- not yet tracked — enable the cost monitor (M2) or drop an export in `state/inbox/`.');
  S.push('');

  if (model.investigations.length) {
    S.push('## 🔎 Investigations (ongoing)');
    for (const i of model.investigations) {
      S.push(`- ${i.question} — ${i.status}.${i.next_step ? ` Next: ${i.next_step}` : ''}`);
    }
    S.push('');
  }

  if (model.watching.length) {
    S.push('## 👀 Watching (FYI)');
    for (const f of model.watching) S.push(`- ${f.title} _(${proj(f.project_id)})_`);
    S.push('');
  }

  if (!model.priority.length && !model.watching.length && !model.needsDecision.length) {
    S.push('_All clear. No items need your attention._\n');
  }

  const footer = `Pushes since last brief: ${model.stats.pushes} · \`/guai-status\` for the live dashboard`;
  return tpl
    .replace('{{date}}', model.date)
    .replace('{{headline}}', model.headline)
    .replace('{{body}}', S.join('\n').trimEnd())
    .replace('{{footer}}', footer);
}
