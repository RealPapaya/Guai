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

// --- i18n ---------------------------------------------------------------------
// All user-visible strings live here. Static markup carries data-i18n / data-i18n-title
// attributes (applied by applyI18n); dynamically-built nodes call t() directly. {vars}
// are interpolated. Missing zh-TW keys fall back to English, missing English to the key.
const I18N = {
  en: {
    'brand.subtitle': 'Chief of Staff',
    'refresh': 'Refresh',
    'badge.armed': 'armed',
    'badge.idle': 'idle',

    'tab.status': 'Status',
    'tab.monitors': 'Monitors',
    'tab.config': 'Config',
    'tab.accounts': 'Accounts',
    'tab.actions': 'Actions',
    'tab.schedule': 'Schedule',

    'status.runSweep': 'Run sweep now',
    'status.openDashboard': 'Open full dashboard ↗',
    'status.topFindings': 'Top open findings',
    'status.noFindings': 'No open findings. 🎉',
    'status.running': 'Running dev + cost sweep…',
    'status.sweepDone': 'Done — {findings} findings, {hot} hot{skipped}.',
    'status.skipped': ' (skipped: {list})',
    'status.failed': 'Status failed: {msg}',
    'status.card.open': 'open findings',
    'status.card.push': 'push / escalate',
    'status.card.pending': 'awaiting approval',
    'status.card.cost': 'latest cost/day',
    'status.card.projects': 'active projects',
    'status.card.lastSweep': 'last sweep',
    'th.action': 'Action',
    'th.sev': 'Sev',
    'th.priority': 'P',
    'th.src': 'Src',
    'th.title': 'Title',
    'time.never': 'never',
    'time.mAgo': '{n}m ago',
    'time.hAgo': '{n}h ago',
    'time.dAgo': '{n}d ago',

    'monitors.intro': 'Arm or disarm each domain independently. dev and cost run in the deterministic sweep (and the "Run sweep now" button). email and calendar need Claude Code\'s MCP agents, so they only run inside the scheduled Claude Code sweep — the toggle here is honored there.',
    'monitors.failed': 'Failed: {msg}',
    'domain.dev.name': 'Dev (GitHub)',
    'domain.dev.sub': 'CI failures, stale PRs, review backlog · deterministic',
    'domain.cost.name': 'Cost',
    'domain.cost.sub': 'AI spend anomalies & budget run-rate · deterministic',
    'domain.email.name': 'Email',
    'domain.email.sub': 'Gmail triage & draft replies · needs Claude Code MCP',
    'domain.calendar.name': 'Calendar',
    'domain.calendar.sub': 'Conflicts & meeting prep · needs Claude Code MCP',

    'config.intro': 'Edits are validated and saved to config/guai.config.json. A running sweep/brief picks them up on its next run (no hot reload).',
    'config.save': 'Save config',
    'cfg.push.maxPerHour': 'Max pushes / hour',
    'cfg.push.maxPerDay': 'Max pushes / day',
    'cfg.push.maxChars': 'Push max characters',
    'cfg.gate.pushThreshold': 'Gate push threshold',
    'cfg.quietHours.start': 'Quiet hours start (0–23)',
    'cfg.quietHours.end': 'Quiet hours end (0–23)',
    'cfg.cost.monthlyBudgetUsd': 'Monthly budget (USD)',
    'cfg.cost.expectedDailyUsd': 'Expected daily (USD)',
    'cfg.github.repos': 'Watched repos (one owner/name per line)',
    'saved': 'Saved.',

    'accounts.intro': 'Connect the accounts Guai monitors and acts through. Tokens are stored locally in state/secrets.json (gitignored) and never leave this machine. Environment variables take precedence over saved tokens.',
    'accounts.ownerLabel': 'Owner email',
    'accounts.saveIdentity': 'Save',
    'accounts.connections': 'Connections',
    'acct.github.name': 'GitHub',
    'acct.github.desc': 'Personal access token (read-only) for the repos you watch.',
    'acct.github.placeholder': 'github_pat_… / ghp_…',
    'acct.gmail.name': 'Gmail',
    'acct.gmail.desc': 'Inbox triage & draft replies.',
    'acct.gmail.note': 'Managed via Claude Code\'s MCP OAuth — run /guai-setup to connect or reconnect the mailbox. No token is stored here.',
    'acct.line.name': 'LINE',
    'acct.line.desc': 'Delivery channel for notifications (LINE token).',
    'acct.line.placeholder': 'LINE channel / notify token',
    'acct.claude.name': 'Claude (Anthropic)',
    'acct.claude.desc': 'Anthropic API key for the judgment layer.',
    'acct.claude.placeholder': 'sk-ant-…',
    'acct.codex.name': 'Codex (OpenAI)',
    'acct.codex.desc': 'OpenAI API key (optional).',
    'acct.codex.placeholder': 'sk-…',
    'acct.status.connected': 'Connected',
    'acct.status.notset': 'Not configured',
    'acct.status.env': 'Via environment',
    'acct.status.mcp': 'Via Claude Code MCP',
    'acct.save': 'Save',
    'acct.saved': 'Saved.',
    'acct.cleared': 'Cleared.',
    'acct.viaEnvNote': 'Currently set via an environment variable, which takes precedence — clear that variable to manage the token here.',
    'acct.viaEnvPlaceholder': 'set via environment variable',
    'acct.failed': 'Failed: {msg}',

    'actions.intro': 'Outward actions Guai has drafted. Approving here only records the decision — nothing is sent. Execution stays behind /guai-confirm.',
    'actions.none': 'Nothing awaiting approval.',
    'actions.approve': 'Approve (record)',
    'actions.reject': 'Reject',
    'actions.proposed': 'proposed {proposed}{expires}',
    'actions.expires': ' · expires {time}',
    'actions.failed': 'Failed: {msg}',

    'schedule.intro': 'Activate the daily report. While Guai is open (incl. the tray) the in-app scheduler fires it; enable durable to also register a Windows scheduled task so it runs even when the app is closed.',
    'schedule.save': 'Save schedule',
    'sch.enabled': 'Activate daily report',
    'sch.dailyBriefHour': 'Brief hour (0–23)',
    'sch.dailyBriefMinute': 'Brief minute (0–59)',
    'sch.weekdaysOnly': 'Weekdays only',
    'sch.sweepEveryMinutes': 'Sweep every N minutes',
    'sch.durable': 'Durable (Windows task — runs when app closed)',
    'schedule.installed': 'durable task installed',
    'schedule.nextRun': 'next durable run',
    'schedule.yes': 'yes',
    'schedule.no': 'no',
    'schedule.durableInstalled': ' Durable task installed.',
    'schedule.durableFailed': ' Durable task NOT installed: {err}',
    'unknown': 'unknown',
  },
  'zh-TW': {
    'brand.subtitle': '首席幕僚',
    'refresh': '重新整理',
    'badge.armed': '已啟用',
    'badge.idle': '待命',

    'tab.status': '狀態',
    'tab.monitors': '監控',
    'tab.config': '設定',
    'tab.accounts': '帳號',
    'tab.actions': '行動',
    'tab.schedule': '排程',

    'status.runSweep': '立即執行掃描',
    'status.openDashboard': '開啟完整儀表板 ↗',
    'status.topFindings': '主要未處理發現',
    'status.noFindings': '沒有未處理的發現。🎉',
    'status.running': '正在執行開發與成本掃描…',
    'status.sweepDone': '完成 — {findings} 項發現，{hot} 項緊急{skipped}。',
    'status.skipped': '（已略過：{list}）',
    'status.failed': '狀態載入失敗：{msg}',
    'status.card.open': '未處理發現',
    'status.card.push': '推播／升級',
    'status.card.pending': '待核准',
    'status.card.cost': '最新每日成本',
    'status.card.projects': '進行中專案',
    'status.card.lastSweep': '上次掃描',
    'th.action': '行動',
    'th.sev': '嚴重度',
    'th.priority': '優先',
    'th.src': '來源',
    'th.title': '標題',
    'time.never': '從未',
    'time.mAgo': '{n} 分鐘前',
    'time.hAgo': '{n} 小時前',
    'time.dAgo': '{n} 天前',

    'monitors.intro': '可獨立啟用或停用每個領域。dev 與 cost 在確定性掃描（以及「立即執行掃描」按鈕）中執行；email 與 calendar 需要 Claude Code 的 MCP 代理，因此只在排程的 Claude Code 掃描中執行 — 此處的開關會被沿用。',
    'monitors.failed': '失敗：{msg}',
    'domain.dev.name': '開發（GitHub）',
    'domain.dev.sub': 'CI 失敗、停滯 PR、審查積壓 · 確定性',
    'domain.cost.name': '成本',
    'domain.cost.sub': 'AI 花費異常與預算消耗率 · 確定性',
    'domain.email.name': '電子郵件',
    'domain.email.sub': 'Gmail 分類與草擬回覆 · 需 Claude Code MCP',
    'domain.calendar.name': '行事曆',
    'domain.calendar.sub': '衝突偵測與會議準備 · 需 Claude Code MCP',

    'config.intro': '編輯會經過驗證並儲存至 config/guai.config.json。執行中的掃描／簡報會在下次執行時套用（不會即時重載）。',
    'config.save': '儲存設定',
    'cfg.push.maxPerHour': '每小時最多推播',
    'cfg.push.maxPerDay': '每日最多推播',
    'cfg.push.maxChars': '推播最大字數',
    'cfg.gate.pushThreshold': '閘門推播門檻',
    'cfg.quietHours.start': '勿擾開始（0–23）',
    'cfg.quietHours.end': '勿擾結束（0–23）',
    'cfg.cost.monthlyBudgetUsd': '每月預算（美元）',
    'cfg.cost.expectedDailyUsd': '預期每日（美元）',
    'cfg.github.repos': '監控的儲存庫（每行一個 owner/name）',
    'saved': '已儲存。',

    'accounts.intro': '連結 Guai 監控與運作所使用的帳號。權杖會儲存在本機的 state/secrets.json（已被 gitignore），絕不離開這台電腦。環境變數的優先順序高於已儲存的權杖。',
    'accounts.ownerLabel': '擁有者電子郵件',
    'accounts.saveIdentity': '儲存',
    'accounts.connections': '連結',
    'acct.github.name': 'GitHub',
    'acct.github.desc': '用於監控儲存庫的個人存取權杖（唯讀）。',
    'acct.github.placeholder': 'github_pat_… / ghp_…',
    'acct.gmail.name': 'Gmail',
    'acct.gmail.desc': '收件匣分類與草擬回覆。',
    'acct.gmail.note': '透過 Claude Code 的 MCP OAuth 管理 — 執行 /guai-setup 以連結或重新連結信箱。此處不會儲存權杖。',
    'acct.line.name': 'LINE',
    'acct.line.desc': '通知的傳遞管道（LINE 權杖）。',
    'acct.line.placeholder': 'LINE 頻道／通知權杖',
    'acct.claude.name': 'Claude（Anthropic）',
    'acct.claude.desc': '判斷層使用的 Anthropic API 金鑰。',
    'acct.claude.placeholder': 'sk-ant-…',
    'acct.codex.name': 'Codex（OpenAI）',
    'acct.codex.desc': 'OpenAI API 金鑰（選用）。',
    'acct.codex.placeholder': 'sk-…',
    'acct.status.connected': '已連結',
    'acct.status.notset': '尚未設定',
    'acct.status.env': '來自環境變數',
    'acct.status.mcp': '透過 Claude Code MCP',
    'acct.save': '儲存',
    'acct.saved': '已儲存。',
    'acct.cleared': '已清除。',
    'acct.viaEnvNote': '目前由環境變數設定，且優先順序較高 — 請清除該變數才能在此管理權杖。',
    'acct.viaEnvPlaceholder': '由環境變數設定',
    'acct.failed': '失敗：{msg}',

    'actions.intro': 'Guai 草擬的對外行動。在此核准僅會記錄決定 — 不會送出任何內容。實際執行仍須透過 /guai-confirm。',
    'actions.none': '沒有待核准的項目。',
    'actions.approve': '核准（記錄）',
    'actions.reject': '拒絕',
    'actions.proposed': '提出於 {proposed}{expires}',
    'actions.expires': ' · 到期 {time}',
    'actions.failed': '失敗：{msg}',

    'schedule.intro': '啟用每日報告。當 Guai 開啟時（含常駐列），應用程式內的排程器會觸發；啟用「持久」可額外註冊 Windows 排程工作，讓它在應用程式關閉時仍能執行。',
    'schedule.save': '儲存排程',
    'sch.enabled': '啟用每日報告',
    'sch.dailyBriefHour': '簡報時（0–23）',
    'sch.dailyBriefMinute': '簡報分（0–59）',
    'sch.weekdaysOnly': '僅工作日',
    'sch.sweepEveryMinutes': '每 N 分鐘掃描',
    'sch.durable': '持久（Windows 工作 — 應用程式關閉時執行）',
    'schedule.installed': '已安裝持久工作',
    'schedule.nextRun': '下次持久執行',
    'schedule.yes': '是',
    'schedule.no': '否',
    'schedule.durableInstalled': ' 已安裝持久工作。',
    'schedule.durableFailed': ' 持久工作未安裝：{err}',
    'unknown': '未知',
  },
};

let LANG = 'en';
/** Translate a key with optional {var} interpolation; falls back en → key. */
function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
}
/** Paint every static [data-i18n]/[data-i18n-title] node for the current language. */
function applyI18n() {
  document.documentElement.lang = LANG === 'zh-TW' ? 'zh-Hant' : 'en';
  $$('[data-i18n]').forEach((n) => { n.textContent = t(/** @type {string} */(n.dataset.i18n)); });
  $$('[data-i18n-title]').forEach((n) => { n.title = t(/** @type {string} */(n.dataset.i18nTitle)); });
}
async function setLang(lang, persist) {
  LANG = lang === 'zh-TW' ? 'zh-TW' : 'en';
  applyI18n();
  // Re-render the active tab so JS-built strings (cards, labels, rows) update too.
  const active = $('.tab.active');
  if (active) activate(/** @type {string} */ (active.dataset.tab));
  if (persist) {
    try {
      const cfg = await call(api.getConfig());
      cfg.ui = { ...(cfg.ui || {}), language: LANG };
      await call(api.saveConfig(cfg));
    } catch (e) { flash($('#status-msg'), /** @type {Error} */(e).message, true); }
  }
}

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString() : '—');
// Color comes from a CSS class (see styles.css) — no inline styles, so CSP stays strict.
const chip = (txt, cls) => el('span', { class: 'chip ' + cls }, txt);

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

const LOADERS = { status: loadStatus, monitors: loadMonitors, config: loadConfigTab, accounts: loadAccounts, actions: loadActions, schedule: loadSchedule };
function activate(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  LOADERS[name]?.();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => activate(/** @type {string} */(t.dataset.tab))));

function setArmed(on) {
  const b = $('#armed-badge');
  b.textContent = t(on ? 'badge.armed' : 'badge.idle');
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
      stat(s.findings.open, t('status.card.open')),
      stat((ba.push || 0) + (ba.escalate || 0), t('status.card.push')),
      stat(s.pending.length, t('status.card.pending')),
      stat(s.cost.latestUsd != null ? `~$${s.cost.latestUsd}` : '—', t('status.card.cost')),
      stat(s.projects.length, t('status.card.projects')),
      stat(s.lastRun ? timeAgo(s.lastRun) : t('time.never'), t('status.card.lastSweep')),
    );
    if (!s.findings.top.length) {
      findings.replaceChildren(el('div', { class: 'empty' }, t('status.noFindings')));
    } else {
      const rows = s.findings.top.map((f) => el('tr', {},
        el('td', {}, chip(f.action || '?', 'a-' + (f.action || 'unknown'))),
        el('td', {}, chip('S' + f.severity, 'sev-' + (f.severity ?? 0))),
        el('td', { text: String(Math.round(f.priority)) }),
        el('td', { class: 'muted', text: f.source }),
        el('td', { text: f.title }),
      ));
      const heads = [t('th.action'), t('th.sev'), t('th.priority'), t('th.src'), t('th.title')];
      findings.replaceChildren(el('table', {},
        el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', { text: h })))),
        el('tbody', {}, ...rows)));
    }
  } catch (e) {
    cards.replaceChildren(el('div', { class: 'err' }, t('status.failed', { msg: e.message })));
    findings.replaceChildren();
  }
}
const stat = (big, label) => el('div', { class: 'card' }, el('div', { class: 'big', text: String(big) }), el('div', { class: 'label', text: label }));
function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return t('time.mAgo', { n: m });
  if (m < 1440) return t('time.hAgo', { n: Math.round(m / 60) });
  return t('time.dAgo', { n: Math.round(m / 1440) });
}

$('#run-sweep').addEventListener('click', async () => {
  const btn = /** @type {HTMLButtonElement} */ ($('#run-sweep')); const msg = $('#status-msg');
  btn.disabled = true; msg.className = 'muted'; msg.textContent = t('status.running');
  try {
    const r = await call(api.runSweep());
    const skipped = r.skipped?.length ? t('status.skipped', { list: r.skipped.join(', ') }) : '';
    flash(msg, t('status.sweepDone', { findings: r.counts.findings, hot: r.hot.length, skipped }), false);
    loadStatus();
  } catch (e) { flash(msg, e.message, true); }
  finally { btn.disabled = false; }
});
$('#refresh').addEventListener('click', () => activate(/** @type {string} */($('.tab.active').dataset.tab)));
$('#open-dashboard').addEventListener('click', async () => {
  try { await call(api.openDashboard()); } catch (e) { flash($('#status-msg'), e.message, true); }
});

// --- MONITORS -----------------------------------------------------------------

const DOMAINS = ['dev', 'cost', 'email', 'calendar'];
async function loadMonitors() {
  const wrap = $('#monitors');
  try {
    const flags = await call(api.getConfig()).then((c) => c.monitors || {});
    wrap.replaceChildren(...DOMAINS.map((d) => {
      const on = flags[d] !== false;
      const input = el('input', { type: 'checkbox' });
      /** @type {HTMLInputElement} */ (input).checked = on;
      input.addEventListener('change', async () => {
        try { await call(api.setMonitor(d, /** @type {HTMLInputElement} */(input).checked)); }
        catch (e) { alert(t('monitors.failed', { msg: e.message })); /** @type {HTMLInputElement} */(input).checked = on; }
      });
      return el('div', { class: 'toggle-row' },
        el('div', {}, el('div', { class: 'name', text: t(`domain.${d}.name`) }), el('div', { class: 'sub', text: t(`domain.${d}.sub`) })),
        el('label', { class: 'switch' }, input, el('span', { class: 'slider' })));
    }));
  } catch (e) { wrap.replaceChildren(el('div', { class: 'err' }, e.message)); }
}

// --- CONFIG -------------------------------------------------------------------

/** @type {any} */ let loadedConfig = null;
// [config path, i18n label key, input type]
const CONFIG_FIELDS = [
  ['push.maxPerHour', 'cfg.push.maxPerHour', 'number'],
  ['push.maxPerDay', 'cfg.push.maxPerDay', 'number'],
  ['push.maxChars', 'cfg.push.maxChars', 'number'],
  ['gate.pushThreshold', 'cfg.gate.pushThreshold', 'number'],
  ['quietHours.start', 'cfg.quietHours.start', 'number'],
  ['quietHours.end', 'cfg.quietHours.end', 'number'],
  ['cost.monthlyBudgetUsd', 'cfg.cost.monthlyBudgetUsd', 'number'],
  ['cost.expectedDailyUsd', 'cfg.cost.expectedDailyUsd', 'number'],
  // Brief timing lives on the Schedule tab (config.schedule), not here — avoids a second
  // control for the same thing. The Schedule tab mirrors it into config.brief for the cron.
  ['github.repos', 'cfg.github.repos', 'repos'],
];
async function loadConfigTab() {
  const form = $('#config-form');
  try {
    loadedConfig = await call(api.getConfig());
    form.replaceChildren();
    for (const [path, labelKey, type] of CONFIG_FIELDS) {
      const id = 'cfg-' + path.replace(/\./g, '-');
      form.append(el('label', { for: id, text: t(labelKey) }));
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
  try { await call(api.saveConfig(next)); loadedConfig = next; flash(msg, t('saved'), false); }
  catch (e) { flash(msg, e.message, true); }
});

// --- ACCOUNTS -----------------------------------------------------------------
// Token accounts carry a secret name; oauth accounts (Gmail) are MCP-managed and show a
// note instead of an input. The raw token never crosses the bridge — getSecrets() returns
// only {set,source}, and saveSecret() writes it server-side (state/secrets.json).
const ACCOUNTS = [
  { id: 'github', secret: 'GITHUB_TOKEN' },
  { id: 'gmail', oauth: true },
  { id: 'line', secret: 'LINE_TOKEN' },
  { id: 'claude', secret: 'ANTHROPIC_API_KEY' },
  { id: 'codex', secret: 'OPENAI_API_KEY' },
];

function statusChip(a, secrets) {
  if (a.oauth) return chip(t('acct.status.mcp'), 'a-digest');
  const st = secrets[a.secret] || {};
  if (st.source === 'env') return chip(t('acct.status.env'), 'a-store');
  if (st.set) return chip(t('acct.status.connected'), 'a-push');
  return chip(t('acct.status.notset'), 'a-ignore');
}

function accountRow(a, secrets) {
  const head = el('div', { class: 'acct-head' },
    el('div', {},
      el('div', { class: 'name', text: t(`acct.${a.id}.name`) }),
      el('div', { class: 'sub', text: t(`acct.${a.id}.desc`) })),
    statusChip(a, secrets));

  if (a.oauth) {
    return el('div', { class: 'acct-item' }, head,
      el('div', { class: 'acct-note', text: t(`acct.${a.id}.note`) }));
  }

  const st = secrets[a.secret] || { set: false, source: null };
  const viaEnv = st.source === 'env';
  const input = el('input', {
    id: `secret-${a.secret}`, type: 'password', autocomplete: 'off', spellcheck: 'false',
    placeholder: viaEnv ? t('acct.viaEnvPlaceholder') : t(`acct.${a.id}.placeholder`),
  });
  if (viaEnv) /** @type {HTMLInputElement} */ (input).disabled = true;
  const msg = el('span', { class: 'muted' });
  const saveBtn = el('button', {
    class: 'primary',
    onclick: async () => {
      const value = /** @type {HTMLInputElement} */ (input).value;
      try {
        await call(api.saveSecret(a.secret, value));
        /** @type {HTMLInputElement} */ (input).value = '';
        flash(msg, value.trim() ? t('acct.saved') : t('acct.cleared'), false);
        loadAccounts();
      } catch (e) { flash(msg, t('acct.failed', { msg: e.message }), true); }
    },
  }, t('acct.save'));
  if (viaEnv) /** @type {HTMLButtonElement} */ (saveBtn).disabled = true;

  return el('div', { class: 'acct-item' }, head,
    el('div', { class: 'acct-row' }, input, saveBtn, msg),
    viaEnv ? el('div', { class: 'acct-note', text: t('acct.viaEnvNote') }) : null);
}

async function loadAccounts() {
  const wrap = $('#accounts');
  try {
    const cfg = await call(api.getConfig());
    /** @type {HTMLInputElement} */ ($('#acct-owner')).value = cfg.owner || '';
  } catch { /* leave the owner field as-is */ }
  try {
    const secrets = await call(api.getSecrets());
    wrap.replaceChildren(...ACCOUNTS.map((a) => accountRow(a, secrets)));
  } catch (e) { wrap.replaceChildren(el('div', { class: 'err' }, e.message)); }
}
$('#identity-save').addEventListener('click', async () => {
  const msg = $('#identity-msg');
  try {
    const cfg = await call(api.getConfig());
    cfg.owner = /** @type {HTMLInputElement} */ ($('#acct-owner')).value.trim();
    await call(api.saveConfig(cfg));
    flash(msg, t('acct.saved'), false);
  } catch (e) { flash(msg, e.message, true); }
});

// --- ACTIONS ------------------------------------------------------------------

async function loadActions() {
  const wrap = $('#actions');
  try {
    const list = await call(api.actions());
    if (!list.length) { wrap.replaceChildren(el('div', { class: 'empty' }, t('actions.none'))); return; }
    wrap.replaceChildren(...list.map((a) => {
      const decide = async (status) => {
        try { await call(api.decide(a.id, status)); loadActions(); }
        catch (e) { alert(t('actions.failed', { msg: e.message })); }
      };
      const expires = a.expires_at ? t('actions.expires', { time: fmtTime(a.expires_at) }) : '';
      return el('div', { class: 'action-item' },
        el('div', {}, el('b', { text: a.kind }), '  ', el('span', { class: 'muted', text: a.rationale || (a.payload_json && a.payload_json.summary) || '' })),
        el('div', { class: 'meta', text: t('actions.proposed', { proposed: fmtTime(a.proposed_at), expires }) }),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => decide('approved') }, t('actions.approve')),
          el('button', { class: 'ghost', onclick: () => decide('rejected') }, t('actions.reject'))));
    }));
  } catch (e) { wrap.replaceChildren(el('div', { class: 'err' }, e.message)); }
}

// --- SCHEDULE -----------------------------------------------------------------

// [schedule key, i18n label key, control type]
const SCHEDULE_FIELDS = [
  ['enabled', 'sch.enabled', 'check'],
  ['dailyBriefHour', 'sch.dailyBriefHour', 'number'],
  ['dailyBriefMinute', 'sch.dailyBriefMinute', 'number'],
  ['weekdaysOnly', 'sch.weekdaysOnly', 'check'],
  ['sweepEveryMinutes', 'sch.sweepEveryMinutes', 'number'],
  ['durable', 'sch.durable', 'check'],
];
async function loadSchedule() {
  const form = $('#schedule-form'); const state = $('#schedule-state');
  try {
    const { schedule, taskScheduler } = await call(api.getSchedule());
    setArmed(schedule?.enabled);
    form.replaceChildren();
    for (const [key, labelKey, type] of SCHEDULE_FIELDS) {
      const id = 'sch-' + key;
      form.append(el('label', { for: id, text: t(labelKey) }));
      const input = el('input', { id, type: type === 'check' ? 'checkbox' : 'number' });
      if (type === 'check') /** @type {HTMLInputElement} */ (input).checked = !!schedule?.[key];
      else /** @type {HTMLInputElement} */ (input).value = String(schedule?.[key] ?? '');
      form.append(input);
    }
    state.replaceChildren(
      stat(taskScheduler?.installed ? t('schedule.yes') : t('schedule.no'), t('schedule.installed')),
      stat(taskScheduler?.nextRun || '—', t('schedule.nextRun')),
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
    let note = t('saved');
    if (sched.durable) note += r.durable?.installed ? t('schedule.durableInstalled') : t('schedule.durableFailed', { err: r.durable?.error || t('unknown') });
    flash(msg, note, sched.durable && !r.durable?.installed);
    loadSchedule();
  } catch (e) { flash(msg, e.message, true); }
});

// --- boot ---------------------------------------------------------------------

$('#lang-select').addEventListener('change', (e) => setLang(/** @type {HTMLSelectElement} */ (e.target).value, true));
api.onRefreshed(() => { if ($('.tab.active').dataset.tab === 'status') loadStatus(); });

(async function boot() {
  try {
    const cfg = await call(api.getConfig());
    LANG = cfg?.ui?.language === 'zh-TW' ? 'zh-TW' : 'en';
  } catch { /* default to English if config can't be read */ }
  /** @type {HTMLSelectElement} */ ($('#lang-select')).value = LANG;
  applyI18n();
  activate('status');
})();
