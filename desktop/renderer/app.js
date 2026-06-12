// @ts-check
// Renderer logic. Sandboxed: no Node, no fetch — every effect goes through window.guai
// (see preload.js). DOM is built with a small el() helper (no innerHTML ⇒ CSP-safe).
// NB: name the local binding `api`, not `guai` — contextBridge already defines a global
// `guai`, and a top-level `const guai` in a classic script collides (redeclaration error).
const api = /** @type {any} */ (window).guai;

const $ = (sel, root = document) => /** @type {HTMLElement} */ (root.querySelector(sel));
const $$ = (sel, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(sel)]);

/** Tiny hyperscript: el('div', {class:'x', onclick:fn}, child, 'text'). */
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    node.append(/** @type {any} */ (kid).nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString() : '—');
const ACTION_COLOR = { push: '#d6336c', escalate: '#e8590c', digest: '#6b9bd1', store: '#868e96', ignore: '#ced4da' };
const SEV_COLOR = ['#9aa', '#6b9bd1', '#e0a800', '#e8590c', '#d6336c'];
const chip = (txt, color) => el('span', { class: 'chip', style: `background:${color || '#868e96'}` }, txt);

/** Unwrap a {ok,data}|{ok:false,error} bridge reply, throwing on error. */
async function call(promise) {
  const r = await promise;
  if (!r || r.ok === false) throw new Error((r && r.error) || 'unknown error');
  return r.data;
}
function flash(node, msg, isErr) {
  node.textContent = msg;
  node.className = isErr ? 'err' : 'ok';
  setTimeout(() => { node.textContent = ''; node.className = 'muted'; }, 4000);
}

// path get/set for the config form
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const keys = p.split('.'); const last = keys.pop();
  let cur = o; for (const k of keys) cur = (cur[k] ??= {});
  cur[last] = v;
}

// --- tabs ---------------------------------------------------------------------

const LOADERS = { status: loadStatus, monitors: loadMonitors, config: loadConfigTab, actions: loadActions, schedule: loadSchedule };
function activate(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  LOADERS[name]?.();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => activate(/** @type {string} */(t.dataset.tab))));

function setArmed(on) {
  const b = $('#armed-badge');
  b.textContent = on ? 'armed' : 'idle';
  b.className = 'badge ' + (on ? 'badge-armed' : 'badge-idle');
}

// --- STATUS -------------------------------------------------------------------

async function loadStatus() {
  const cards = $('#status-cards'); const findings = $('#findings');
  try {
    const s = await call(api.status());
    setArmed(s.taskScheduler?.installed || s.schedule?.enabled);
    const ba = s.findings.byAction || {};
    cards.replaceChildren(
      stat(s.findings.open, 'open findings'),
      stat((ba.push || 0) + (ba.escalate || 0), 'push / escalate'),
      stat(s.pending.length, 'awaiting approval'),
      stat(s.cost.latestUsd != null ? `~$${s.cost.latestUsd}` : '—', 'latest cost/day'),
      stat(s.projects.length, 'active projects'),
      stat(s.lastRun ? timeAgo(s.lastRun) : 'never', 'last sweep'),
    );
    if (!s.findings.top.length) {
      findings.replaceChildren(el('div', { class: 'empty' }, 'No open findings. 🎉'));
    } else {
      const rows = s.findings.top.map((f) => el('tr', {},
        el('td', {}, chip(f.action || '?', ACTION_COLOR[f.action])),
        el('td', {}, chip('S' + f.severity, SEV_COLOR[f.severity])),
        el('td', { text: String(Math.round(f.priority)) }),
        el('td', { class: 'muted', text: f.source }),
        el('td', { text: f.title }),
      ));
      findings.replaceChildren(el('table', {},
        el('thead', {}, el('tr', {}, ...['Action', 'Sev', 'P', 'Src', 'Title'].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...rows)));
    }
  } catch (e) {
    cards.replaceChildren(el('div', { class: 'err' }, 'Status failed: ' + e.message));
    findings.replaceChildren();
  }
}
const stat = (big, label) => el('div', { class: 'card' }, el('div', { class: 'big', text: String(big) }), el('div', { class: 'label', text: label }));
function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

$('#run-sweep').addEventListener('click', async () => {
  const btn = /** @type {HTMLButtonElement} */ ($('#run-sweep')); const msg = $('#status-msg');
  btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Running dev + cost sweep…';
  try {
    const r = await call(api.runSweep());
    const skipped = r.skipped?.length ? ` (skipped: ${r.skipped.join(', ')})` : '';
    flash(msg, `Done — ${r.counts.findings} findings, ${r.hot.length} hot${skipped}.`, false);
    loadStatus();
  } catch (e) { flash(msg, e.message, true); }
  finally { btn.disabled = false; }
});
$('#refresh').addEventListener('click', () => activate(/** @type {string} */($('.tab.active').dataset.tab)));
$('#open-dashboard').addEventListener('click', async () => {
  try { await call(api.openDashboard()); } catch (e) { flash($('#status-msg'), e.message, true); }
});

// --- MONITORS -----------------------------------------------------------------

const DOMAIN_INFO = {
  dev: { name: 'Dev (GitHub)', sub: 'CI failures, stale PRs, review backlog · deterministic' },
  cost: { name: 'Cost', sub: 'AI spend anomalies & budget run-rate · deterministic' },
  email: { name: 'Email', sub: 'Gmail triage & draft replies · needs Claude Code MCP' },
  calendar: { name: 'Calendar', sub: 'Conflicts & meeting prep · needs Claude Code MCP' },
};
async function loadMonitors() {
  const wrap = $('#monitors');
  try {
    const flags = await call(api.getConfig()).then((c) => c.monitors || {});
    wrap.replaceChildren(...Object.keys(DOMAIN_INFO).map((d) => {
      const on = flags[d] !== false;
      const input = el('input', { type: 'checkbox' });
      /** @type {HTMLInputElement} */ (input).checked = on;
      input.addEventListener('change', async () => {
        try { await call(api.setMonitor(d, /** @type {HTMLInputElement} */(input).checked)); }
        catch (e) { alert('Failed: ' + e.message); /** @type {HTMLInputElement} */(input).checked = on; }
      });
      return el('div', { class: 'toggle-row' },
        el('div', {}, el('div', { class: 'name', text: DOMAIN_INFO[d].name }), el('div', { class: 'sub', text: DOMAIN_INFO[d].sub })),
        el('label', { class: 'switch' }, input, el('span', { class: 'slider' })));
    }));
  } catch (e) { wrap.replaceChildren(el('div', { class: 'err' }, e.message)); }
}

// --- CONFIG -------------------------------------------------------------------

/** @type {any} */ let loadedConfig = null;
const CONFIG_FIELDS = [
  ['push.maxPerHour', 'Max pushes / hour', 'number'],
  ['push.maxPerDay', 'Max pushes / day', 'number'],
  ['push.maxChars', 'Push max characters', 'number'],
  ['gate.pushThreshold', 'Gate push threshold', 'number'],
  ['quietHours.start', 'Quiet hours start (0–23)', 'number'],
  ['quietHours.end', 'Quiet hours end (0–23)', 'number'],
  ['cost.monthlyBudgetUsd', 'Monthly budget (USD)', 'number'],
  ['cost.expectedDailyUsd', 'Expected daily (USD)', 'number'],
  ['brief.hour', 'Brief hour (0–23)', 'number'],
  ['brief.minute', 'Brief minute (0–59)', 'number'],
  ['github.repos', 'Watched repos (one owner/name per line)', 'repos'],
];
async function loadConfigTab() {
  const form = $('#config-form');
  try {
    loadedConfig = await call(api.getConfig());
    form.replaceChildren();
    for (const [path, label, type] of CONFIG_FIELDS) {
      const id = 'cfg-' + path.replace(/\./g, '-');
      form.append(el('label', { for: id, text: label }));
      if (type === 'repos') {
        const ta = el('textarea', { id, class: 'full' });
        /** @type {HTMLTextAreaElement} */ (ta).value = (getPath(loadedConfig, path) || []).join('\n');
        form.append(ta);
      } else {
        const input = el('input', { id, type });
        /** @type {HTMLInputElement} */ (input).value = String(getPath(loadedConfig, path) ?? '');
        form.append(input);
      }
    }
  } catch (e) { form.replaceChildren(el('div', { class: 'err' }, e.message)); }
}
$('#config-save').addEventListener('click', async () => {
  const msg = $('#config-msg');
  if (!loadedConfig) return;
  const next = JSON.parse(JSON.stringify(loadedConfig)); // edit a clone, preserve unknown keys
  for (const [path, , type] of CONFIG_FIELDS) {
    const id = 'cfg-' + path.replace(/\./g, '-');
    const node = /** @type {HTMLInputElement} */ ($('#' + id));
    if (type === 'repos') setPath(next, path, node.value.split('\n').map((s) => s.trim()).filter(Boolean));
    else setPath(next, path, Number(node.value));
  }
  try { await call(api.saveConfig(next)); loadedConfig = next; flash(msg, 'Saved.', false); }
  catch (e) { flash(msg, e.message, true); }
});

// --- ACTIONS ------------------------------------------------------------------

async function loadActions() {
  const wrap = $('#actions');
  try {
    const list = await call(api.actions());
    if (!list.length) { wrap.replaceChildren(el('div', { class: 'empty' }, 'Nothing awaiting approval.')); return; }
    wrap.replaceChildren(...list.map((a) => {
      const decide = async (status) => {
        try { await call(api.decide(a.id, status)); loadActions(); }
        catch (e) { alert('Failed: ' + e.message); }
      };
      return el('div', { class: 'action-item' },
        el('div', {}, el('b', { text: a.kind }), '  ', el('span', { class: 'muted', text: a.rationale || (a.payload_json && a.payload_json.summary) || '' })),
        el('div', { class: 'meta', text: `proposed ${fmtTime(a.proposed_at)}${a.expires_at ? ` · expires ${fmtTime(a.expires_at)}` : ''}` }),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => decide('approved') }, 'Approve (record)'),
          el('button', { class: 'ghost', onclick: () => decide('rejected') }, 'Reject')));
    }));
  } catch (e) { wrap.replaceChildren(el('div', { class: 'err' }, e.message)); }
}

// --- SCHEDULE -----------------------------------------------------------------

const SCHEDULE_FIELDS = [
  ['enabled', 'Activate daily report', 'check'],
  ['dailyBriefHour', 'Brief hour (0–23)', 'number'],
  ['dailyBriefMinute', 'Brief minute (0–59)', 'number'],
  ['weekdaysOnly', 'Weekdays only', 'check'],
  ['sweepEveryMinutes', 'Sweep every N minutes', 'number'],
  ['durable', 'Durable (Windows task — runs when app closed)', 'check'],
];
async function loadSchedule() {
  const form = $('#schedule-form'); const state = $('#schedule-state');
  try {
    const { schedule, taskScheduler } = await call(api.getSchedule());
    setArmed(schedule?.enabled);
    form.replaceChildren();
    for (const [key, label, type] of SCHEDULE_FIELDS) {
      const id = 'sch-' + key;
      form.append(el('label', { for: id, text: label }));
      const input = el('input', { id, type: type === 'check' ? 'checkbox' : 'number' });
      if (type === 'check') /** @type {HTMLInputElement} */ (input).checked = !!schedule?.[key];
      else /** @type {HTMLInputElement} */ (input).value = String(schedule?.[key] ?? '');
      form.append(input);
    }
    state.replaceChildren(
      stat(taskScheduler?.installed ? 'yes' : 'no', 'durable task installed'),
      stat(taskScheduler?.nextRun || '—', 'next durable run'),
    );
  } catch (e) { form.replaceChildren(el('div', { class: 'err' }, e.message)); }
}
$('#schedule-save').addEventListener('click', async () => {
  const msg = $('#schedule-msg');
  /** @type {any} */ const sched = {};
  for (const [key, , type] of SCHEDULE_FIELDS) {
    const node = /** @type {HTMLInputElement} */ ($('#sch-' + key));
    sched[key] = type === 'check' ? node.checked : Number(node.value);
  }
  try {
    const r = await call(api.setSchedule(sched));
    setArmed(sched.enabled);
    let note = 'Saved.';
    if (sched.durable) note += r.durable?.installed ? ' Durable task installed.' : ` Durable task NOT installed: ${r.durable?.error || 'unknown'}`;
    flash(msg, note, sched.durable && !r.durable?.installed);
    loadSchedule();
  } catch (e) { flash(msg, e.message, true); }
});

// --- boot ---------------------------------------------------------------------

api.onRefreshed(() => { if ($('.tab.active').dataset.tab === 'status') loadStatus(); });
activate('status');
