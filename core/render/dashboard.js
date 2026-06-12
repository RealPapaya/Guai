// Self-contained HTML dashboard from a DB snapshot. Pure function (snapshot → string):
// no server, no external assets, no JS framework — opens straight in a browser. This is
// the portable face of the portable core.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (ts) => (ts ? new Date(ts).toLocaleString('en-US') : '—');
const day = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const parse = (s) => { if (s == null) return {}; try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return {}; } };

const SEV = ['#9aa', '#6b9bd1', '#e0a800', '#e8590c', '#d6336c']; // 0..4
const ACTION = { push: '#d6336c', escalate: '#e8590c', digest: '#6b9bd1', store: '#868e96', ignore: '#ced4da' };

function sparkline(values, w = 260, h = 44) {
  if (!values.length) return '<span class="muted">no data</span>';
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => `${((i / (n - 1 || 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="#d6336c" stroke-width="2" points="${pts}"/></svg>`;
}

export function renderDashboard(snapshot, cfg, clock = Date.now()) {
  const open = (snapshot.findings ?? []).filter((f) => ['open', 'surfaced', 'snoozed'].includes(f.status));
  const projects = (snapshot.projects ?? []).filter((p) => p.status === 'active');
  const pending = (snapshot.action_queue ?? []).filter((a) => a.status === 'pending');
  const investigations = (snapshot.investigations ?? []).filter((i) => i.status === 'open');

  // Cost series: prefer drop-file (real $) else cc-stats (estimate).
  const usage = (snapshot.cost_usage ?? []).slice().sort((a, b) => a.period_start - b.period_start);
  const drop = usage.filter((u) => u.source === 'drop-file');
  const series = (drop.length ? drop : usage.filter((u) => u.source === 'cc-stats')).slice(-30);
  const baseline = (snapshot.cost_baselines ?? []).find((b) => b.metric === 'daily_usd');
  const latest = series.at(-1);

  const countsByAction = {};
  for (const f of open) countsByAction[f.gate_action] = (countsByAction[f.gate_action] ?? 0) + 1;

  const chip = (txt, color) => `<span class="chip" style="background:${color}">${esc(txt)}</span>`;

  const projectCards = projects.map((p) => {
    const fs = open.filter((f) => f.project_id === p.id);
    const c = (k) => fs.filter((f) => f.kind === k).length;
    const bits = [c('ci_failure') && `${c('ci_failure')} CI`, c('review_backlog') && `${c('review_backlog')} review`, c('stale_pr') && `${c('stale_pr')} stale`].filter(Boolean).join(' · ') || 'nominal';
    return `<div class="card"><h3>${esc(p.name)} <span class="muted">${esc(p.status)}</span></h3><div>${esc(bits)}</div></div>`;
  }).join('') || '<div class="muted">No active projects.</div>';

  const findingRows = open.sort((a, b) => b.priority - a.priority).slice(0, 50).map((f) => {
    const d = parse(f.detail_json);
    const link = d.url ? ` <a href="${esc(d.url)}">↗</a>` : '';
    return `<tr><td>${chip(f.gate_action ?? '?', ACTION[f.gate_action] ?? '#999')}</td><td>${chip('S' + f.severity, SEV[f.severity] ?? '#999')}</td><td>${f.priority}</td><td>${esc(f.source)}</td><td>${esc(f.title)}${link}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">No open findings.</td></tr>';

  const actionRows = pending.map((a) => {
    const p = parse(a.payload_json);
    return `<li><b>${esc(a.kind)}</b> — ${esc(a.rationale ?? p.summary ?? '')} <span class="muted">(awaiting /guai-confirm)</span></li>`;
  }).join('') || '<li class="muted">Nothing awaiting approval.</li>';

  const invRows = investigations.map((i) => `<li>${esc(i.question)} — ${esc(i.status)}${i.next_step ? ` · next: ${esc(i.next_step)}` : ''}</li>`).join('') || '<li class="muted">No open investigations.</li>';

  const costBlock = latest
    ? `<div class="bigrow"><div><div class="big">~$${latest.usd}</div><div class="muted">latest day${baseline ? ` · baseline ~$${baseline.baseline_value}` : ''} · est.</div></div><div>${sparkline(series.map((u) => u.usd))}<div class="muted">${series.length ? day(series[0].period_start) + ' → ' + day(latest.period_start) : ''}</div></div></div>`
    : '<div class="muted">No cost data yet — drop an export in state/inbox/ or let a sweep read stats-cache.</div>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guai · Dashboard</title><style>
:root{color-scheme:light dark}
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f1115;color:#e6e8eb}
header{padding:18px 24px;border-bottom:1px solid #262b33;display:flex;justify-content:space-between;align-items:baseline}
h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a3;margin:24px 0 8px}
.wrap{max-width:1000px;margin:0 auto;padding:0 24px 48px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{background:#171a21;border:1px solid #262b33;border-radius:10px;padding:14px}
.card h3{margin:0 0 6px;font-size:15px}
.muted{color:#8b95a3}.big{font-size:30px;font-weight:600}.bigrow{display:flex;gap:40px;align-items:center;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:6px 8px;border-bottom:1px solid #20242c;vertical-align:top}
.chip{display:inline-block;padding:1px 7px;border-radius:20px;color:#fff;font-size:11px;font-weight:600}
a{color:#6b9bd1}ul{padding-left:18px;margin:6px 0}
.statline{display:flex;gap:18px;flex-wrap:wrap;margin-top:4px}
.statline b{font-size:18px}
</style></head><body>
<header><h1>⬢ Guai — Chief of Staff</h1><div class="muted">generated ${fmt(snapshot.generated_at ?? clock)}</div></header>
<div class="wrap">
  <div class="statline">
    <div><b>${open.length}</b> <span class="muted">open findings</span></div>
    <div><b>${countsByAction.push ?? 0}</b> <span class="muted">push</span></div>
    <div><b>${countsByAction.escalate ?? 0}</b> <span class="muted">escalate</span></div>
    <div><b>${pending.length}</b> <span class="muted">awaiting approval</span></div>
    <div><b>${projects.length}</b> <span class="muted">projects</span></div>
  </div>

  <h2>💰 Cost</h2>${costBlock}
  <h2>📦 Projects</h2><div class="grid">${projectCards}</div>
  <h2>⚠ Awaiting your decision</h2><ul>${actionRows}</ul>
  <h2>🔎 Investigations</h2><ul>${invRows}</ul>
  <h2>🔴 Open findings</h2><table><tbody>${findingRows}</tbody></table>
</div></body></html>`;
}
