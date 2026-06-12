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

    'tab.chat': 'Chat',
    'tab.jobs': 'Jobs',
    'settings.title': 'Settings',
    'settings.back': 'Back',
    'settings.general': 'General',
    'settings.language': 'Language',
    'settings.languageDesc': 'Choose the language used throughout Guai.',

    'chat.placeholder': 'Type a command (sweep, brief, status)…',
    'chat.qa.brief': 'Run brief',
    'chat.welcome': "Hi — I'm Guai. I can run: {list}. Type one, or use the buttons below.",
    'chat.running': 'Running {cmd}…',
    'chat.unknown': 'Unknown command "{cmd}". Try: {list}',
    'chat.empty': '(no output)',

    'status.pendingApprovals': 'Pending approvals',

    'jobs.add': 'Add job',
    'jobs.name': 'Name',
    'jobs.description': 'Description',
    'jobs.model': 'Model',
    'jobs.modelAuto': 'Let main agent assign dynamically',
    'jobs.mode': 'Execution mode',
    'jobs.mode.active': 'Active',
    'jobs.mode.passive': 'Passive',
    'jobs.mode.scheduled': 'Scheduled',
    'jobs.cron': 'Schedule (HH:MM or cron)',
    'jobs.subtasks': 'Sub-tasks',
    'jobs.addSubtask': 'Add sub-task',
    'jobs.save': 'Save jobs',
    'jobs.saved': 'Saved.',
    'jobs.empty': 'Select a job, or add one.',
    'jobs.newName': 'New job',
    'jobs.badge.active': 'active',
    'jobs.badge.passive': 'passive',
    'jobs.badge.scheduled': 'scheduled',
    'jobs.failed': 'Failed: {msg}',

    'tab.status': 'Status',
    'tab.monitors': 'Monitors',
    'tab.config': 'Config',
    'tab.accounts': 'Accounts',
    'tab.usage': 'Usage',
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
    'usage.sync': 'Sync now',
    'usage.syncing': 'Syncing local CLI usage...',
    'usage.done': 'Usage synchronized.',
    'usage.allProviders': 'All providers',
    'usage.allProjects': 'All projects',
    'usage.days7': 'Last 7 days',
    'usage.days30': 'Last 30 days',
    'usage.allTime': 'All time',
    'usage.projects': 'Projects',
    'usage.sessions': 'Sessions',
    'usage.none': 'No local Claude/Codex sessions found.',
    'usage.localOnly': 'Local session attribution',
    'usage.quota': '{provider} {window} quota',
    'usage.resets': 'resets {time}',
    'usage.tokens': 'tokens',
    'usage.session': 'Session',
    'usage.project': 'Project',
    'usage.provider': 'Provider',
    'usage.updated': 'Updated',
    'usage.turns': 'Turns',
    'usage.external': 'Web, mobile, and other-computer usage is reflected in account quota only and cannot be attributed locally.',
    'status.subtab.overview': 'Overview',
    'status.subtab.usage': 'Usage',
    'usage.chart.bar': 'Bar',
    'usage.chart.line': 'Line',
    'usage.chart.quotaTrend': 'Quota trend',
    'usage.chart.dailyTokens': 'Daily tokens',
    'usage.window.5h': '5h limit',
    'usage.window.weekly': 'Weekly limit',
    'usage.noChart': 'No usage data yet — press Sync now.',
    'usage.noQuota': 'No quota data yet — press Sync now.',
  },
  'zh-TW': {
    'brand.subtitle': '首席幕僚',
    'refresh': '重新整理',
    'badge.armed': '已啟用',
    'badge.idle': '待命',

    'tab.chat': '對話',
    'tab.jobs': '工作',
    'settings.title': '設定',
    'settings.back': '返回',
    'settings.general': '一般',
    'settings.language': '語言',
    'settings.languageDesc': '選擇 Guai 介面使用的語言。',

    'chat.placeholder': '輸入指令（sweep、brief、status）…',
    'chat.qa.brief': '執行簡報',
    'chat.welcome': '嗨，我是乖。我可以執行：{list}。輸入其中一項，或使用下方按鈕。',
    'chat.running': '正在執行 {cmd}…',
    'chat.unknown': '未知指令「{cmd}」。試試：{list}',
    'chat.empty': '（沒有輸出）',

    'status.pendingApprovals': '待核准',

    'jobs.add': '新增工作',
    'jobs.name': '名稱',
    'jobs.description': '說明',
    'jobs.model': '模型',
    'jobs.modelAuto': '由主代理動態指派',
    'jobs.mode': '執行模式',
    'jobs.mode.active': '主動',
    'jobs.mode.passive': '被動',
    'jobs.mode.scheduled': '排程',
    'jobs.cron': '排程（HH:MM 或 cron）',
    'jobs.subtasks': '子任務',
    'jobs.addSubtask': '新增子任務',
    'jobs.save': '儲存工作',
    'jobs.saved': '已儲存。',
    'jobs.empty': '選擇一個工作，或新增一個。',
    'jobs.newName': '新工作',
    'jobs.badge.active': '主動',
    'jobs.badge.passive': '被動',
    'jobs.badge.scheduled': '排程',
    'jobs.failed': '失敗：{msg}',

    'tab.status': '狀態',
    'tab.monitors': '監控',
    'tab.config': '設定',
    'tab.accounts': '帳號',
    'tab.usage': '用量',
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
    'usage.sync': '立即同步',
    'usage.syncing': '正在同步本機 CLI 用量...',
    'usage.done': '用量同步完成。',
    'usage.allProviders': '所有供應商',
    'usage.allProjects': '所有專案',
    'usage.days7': '最近 7 天',
    'usage.days30': '最近 30 天',
    'usage.allTime': '全部時間',
    'usage.projects': '專案',
    'usage.sessions': '工作階段',
    'usage.none': '尚未找到本機 Claude/Codex 工作階段。',
    'usage.localOnly': '本機工作階段歸因',
    'usage.quota': '{provider} {window} 配額',
    'usage.resets': '重置時間 {time}',
    'usage.tokens': 'tokens',
    'usage.session': '工作階段',
    'usage.project': '專案',
    'usage.provider': '供應商',
    'usage.updated': '更新時間',
    'usage.turns': '回合',
    'usage.external': '網頁、手機及其他電腦的用量只會反映於帳戶配額，無法歸因至本機專案。',
    'status.subtab.overview': '總覽',
    'status.subtab.usage': '用量',
    'usage.chart.bar': '長條圖',
    'usage.chart.line': '折線圖',
    'usage.chart.quotaTrend': '配額走勢',
    'usage.chart.dailyTokens': '每日 token',
    'usage.window.5h': '5 小時',
    'usage.window.weekly': '每週',
    'usage.noChart': '尚無用量資料 — 請按「立即同步」。',
    'usage.noQuota': '尚無配額資料 — 請按「立即同步」。',
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
  $$('[data-i18n-ph]').forEach((n) => { /** @type {HTMLInputElement} */(n).placeholder = t(/** @type {string} */(n.dataset.i18nPh)); });
}
async function setLang(lang, persist) {
  LANG = lang === 'zh-TW' ? 'zh-TW' : 'en';
  applyI18n();
  // Re-render the visible surface so JS-built strings (cards, labels, rows) update too.
  reloadActive();
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

// SVG <use> of a sprite symbol. HTML createElement can't make SVG-namespaced nodes, so
// build them explicitly. Used by JS-built buttons; static markup inlines <svg><use> directly.
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls = 'icon') {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', '#' + name);
  svg.appendChild(use);
  return svg;
}
/** Build an SVG-namespaced element with attributes + children. Geometry/fill go through
 *  presentation ATTRIBUTES (not the style property), so strict style-src CSP stays intact. */
function svgEl(tag, attrs, ...kids) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) node.setAttribute(k, String(v));
  for (const kid of kids) if (kid != null && kid !== false) node.append(kid);
  return node;
}
/** A sprite logo as a standalone <svg> (vs icon(): same, kept for clarity at call sites). */
function logo(name, cls) {
  const svg = svgEl('svg', { class: cls, 'aria-hidden': 'true' });
  svg.appendChild(svgEl('use', { href: '#' + name }));
  return svg;
}

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

// --- tabs + settings (two independent routers; they key off #tab-* vs #set-*) ----

let lastTab = 'chat';
const LOADERS = { chat: loadChat, jobs: loadJobs, status: loadStatusTab };
function activate(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  lastTab = name;
  LOADERS[name]?.();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => activate(/** @type {string} */(t.dataset.tab))));

// Settings full-screen view. Reuses the original tab loaders verbatim — only relocated.
const SETTINGS_LOADERS = { general: loadConfigTab, accounts: loadAccounts, usage: loadUsage, schedule: loadSchedule };
let lastSettings = 'general';
function activateSettings(section) {
  $$('.set-nav-item').forEach((n) => n.classList.toggle('active', n.dataset.set === section));
  $$('.settings-section').forEach((s) => s.classList.toggle('active', s.id === `set-${section}`));
  lastSettings = section;
  SETTINGS_LOADERS[section]?.();
}
function openSettings(section = 'general') { document.body.classList.add('settings-open'); activateSettings(section); }
function closeSettings() { document.body.classList.remove('settings-open'); activate(lastTab); }
$$('.set-nav-item').forEach((n) => n.addEventListener('click', () => activateSettings(/** @type {string} */(n.dataset.set))));
$('#open-settings').addEventListener('click', () => openSettings(lastSettings));
$('#settings-back').addEventListener('click', closeSettings);
/** Re-render whatever surface is currently visible (settings section, else active tab). */
function reloadActive() {
  if (document.body.classList.contains('settings-open')) activateSettings(lastSettings);
  else { const a = $('.tab.active'); if (a) activate(/** @type {string} */ (a.dataset.tab)); }
}

function setArmed(on) {
  const b = $('#armed-badge');
  b.textContent = t(on ? 'badge.armed' : 'badge.idle');
  b.className = 'badge ' + (on ? 'badge-armed' : 'badge-idle');
}

// --- STATUS (Overview / Usage sub-tabs) ---------------------------------------

let lastStatusSub = 'overview';
/** Entry point when the Status tab is opened — defer to the active sub-tab. */
function loadStatusTab() { activateStatusSub(lastStatusSub); }
function activateStatusSub(name) {
  $$('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.subtab === name));
  $$('.status-sub').forEach((s) => s.classList.toggle('active', s.id === `status-${name}`));
  lastStatusSub = name;
  if (name === 'usage') loadStatusUsage(); else loadStatus();
}
$$('.subtab').forEach((b) => b.addEventListener('click', () => activateStatusSub(/** @type {string} */(b.dataset.subtab))));

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
  // Pending approvals + Monitors share the Status panel now — render them alongside.
  loadActions();
  loadMonitors();
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
$('#refresh').addEventListener('click', () => reloadActive());
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

// --- USAGE --------------------------------------------------------------------

const fmtTokens = (n) => new Intl.NumberFormat(LANG, { notation: Number(n) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(n) || 0);

function usageQuotaCard(q) {
  const used = q.used_percent == null ? '?' : `${Math.round(q.used_percent)}%`;
  return el('div', { class: 'card' },
    el('div', { class: 'big', text: used }),
    el('div', { class: 'label', text: t('usage.quota', { provider: q.provider, window: q.window_name }) }),
    el('div', { class: 'meta', text: q.resets_at ? t('usage.resets', { time: fmtTime(q.resets_at) }) : '' }));
}

function usageTotalCard(x) {
  return el('div', { class: 'card' },
    el('div', { class: 'big', text: fmtTokens(x.total_tokens) }),
    el('div', { class: 'label', text: `${x.provider} ${t('usage.tokens')}` }),
    el('div', { class: 'meta', text: `${x.sessions} ${t('usage.sessions')} / ${x.projects} ${t('usage.projects')}` }));
}

function usageAccountCard(a) {
  return el('div', { class: 'card' },
    el('div', { class: 'big provider-name', text: a.provider }),
    el('div', { class: 'label', text: `${a.plan_type || '?'} / ${a.status}` }),
    el('div', { class: 'meta', text: a.last_sync_at ? fmtTime(a.last_sync_at) : '' }));
}

async function showUsageSession(provider, id) {
  const wrap = $('#usage-detail');
  try {
    const s = await call(api.usageSession(provider, id));
    if (!s) return;
    const rows = s.turns.map((x) => el('tr', {},
      el('td', { text: x.title || x.turn_id }), el('td', { class: 'muted', text: x.model || '?' }),
      el('td', { text: fmtTokens(x.input_tokens) }), el('td', { text: fmtTokens(x.cached_tokens) }),
      el('td', { text: fmtTokens(x.output_tokens) }), el('td', { text: fmtTokens(x.reasoning_tokens) }),
      el('td', { text: fmtTokens(x.total_tokens) })));
    wrap.replaceChildren(el('h2', { text: `${t('usage.turns')}: ${s.title || s.session_id}` }),
      el('table', {}, el('thead', {}, el('tr', {}, ...['Turn', 'Model', 'Input', 'Cache', 'Output', 'Reasoning', 'Total'].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...rows)));
  } catch (e) { wrap.replaceChildren(el('div', { class: 'err', text: e.message })); }
}

async function loadUsage() {
  const quota = $('#usage-quota'); const projects = $('#usage-projects'); const sessionsWrap = $('#usage-sessions');
  try {
    const summary = await call(api.usageSummary());
    quota.replaceChildren(...summary.accounts.map(usageAccountCard), ...summary.quota.map(usageQuotaCard), ...summary.totals.map(usageTotalCard));
    const projectSelect = /** @type {HTMLSelectElement} */ ($('#usage-project'));
    const selected = projectSelect.value;
    projectSelect.replaceChildren(el('option', { value: '', text: t('usage.allProjects') }),
      ...summary.projects.map((p) => el('option', { value: p.id, text: p.name })));
    projectSelect.value = selected;
    const projectRows = summary.projects.map((p) => el('tr', {},
      el('td', { text: p.name }), el('td', { text: String(p.sessions) }),
      el('td', { text: fmtTokens(p.total_tokens) }), el('td', { class: 'muted', text: fmtTime(p.latest_at) })));
    projects.replaceChildren(projectRows.length ? el('table', {},
      el('thead', {}, el('tr', {}, ...[t('usage.project'), t('usage.sessions'), t('usage.tokens'), t('usage.updated')].map((h) => el('th', { text: h })))),
      el('tbody', {}, ...projectRows)) : el('div', { class: 'empty', text: t('usage.none') }));

    const provider = /** @type {HTMLSelectElement} */ ($('#usage-provider')).value;
    const projectId = /** @type {HTMLSelectElement} */ ($('#usage-project')).value;
    const days = /** @type {HTMLSelectElement} */ ($('#usage-range')).value;
    const list = await call(api.usageSessions({ provider: provider || null, projectId: projectId ? Number(projectId) : null,
      since: days ? Date.now() - Number(days) * 864e5 : null }));
    const sessionRows = list.map((s) => el('tr', {},
      el('td', {}, el('button', { class: 'link-button', onclick: () => showUsageSession(s.provider, s.session_id) }, s.title || s.session_id)),
      el('td', {}, chip(s.provider, s.provider === 'claude' ? 'a-digest' : 'a-store')),
      el('td', { text: s.project_name || '?' }), el('td', { class: 'muted', text: s.model || '?' }),
      el('td', { text: fmtTokens(s.total_tokens) }), el('td', { class: 'muted', text: fmtTime(s.updated_at) })));
    sessionsWrap.replaceChildren(sessionRows.length ? el('table', {},
      el('thead', {}, el('tr', {}, ...[t('usage.session'), t('usage.provider'), t('usage.project'), 'Model', t('usage.tokens'), t('usage.updated')].map((h) => el('th', { text: h })))),
      el('tbody', {}, ...sessionRows)) : el('div', { class: 'empty', text: t('usage.none') }));
  } catch (e) {
    quota.replaceChildren(el('div', { class: 'err', text: e.message }));
    projects.replaceChildren(); sessionsWrap.replaceChildren();
  }
}

$('#usage-sync').addEventListener('click', async () => {
  const btn = /** @type {HTMLButtonElement} */ ($('#usage-sync')); const msg = $('#usage-msg');
  btn.disabled = true; msg.textContent = t('usage.syncing');
  try { await call(api.syncUsage()); flash(msg, t('usage.done'), false); await loadUsage(); }
  catch (e) { flash(msg, e.message, true); }
  finally { btn.disabled = false; }
});
for (const id of ['usage-provider', 'usage-project', 'usage-range']) $('#' + id).addEventListener('change', loadUsage);

// --- STATUS → USAGE charts ----------------------------------------------------
// Graphical view of provider quota (5h / weekly limits) and token consumption.
// Everything is drawn as inline SVG via attributes (no inline CSS ⇒ CSP-safe).

const PROVIDER_META = {
  claude: { label: 'Claude', icon: 'ic-claude', brand: 'brand-claude', color: '#da7756', dim: '#a8543b' },
  codex: { label: 'Codex', icon: 'ic-openai', brand: 'brand-codex', color: '#10a37f', dim: '#0a6e56' },
};
const provMeta = (p) => PROVIDER_META[p] || { label: p, icon: 'ic-status', brand: '', color: '#6b9bd1', dim: '#41648a' };

/** Normalize a provider's window name into '5h' | 'weekly' | raw, for friendly labels + ordering. */
function windowKind(row) {
  const n = String(row.window_name || '').toLowerCase();
  if (/(seven|week|secondary|7d|day)/.test(n)) return 'weekly';
  if (/(five|hour|primary|5h)/.test(n)) return '5h';
  if (row.window_minutes >= 1440) return 'weekly';
  if (row.window_minutes) return '5h';
  return n || 'other';
}
const windowLabel = (kind) => (kind === '5h' || kind === 'weekly') ? t('usage.window.' + kind) : kind;
const WINDOW_ORDER = { '5h': 0, weekly: 1 };
/** A series color: provider base for the 5h window, dimmed for weekly/other. */
const windowColor = (provider, kind) => kind === '5h' ? provMeta(provider).color : provMeta(provider).dim;

let usageChartType = 'bar';   // 'bar' | 'line'
let usageLineKind = 'quota';  // 'quota' | 'tokens'
/** @type {any} */ let usageChartData = null;

async function loadStatusUsage() {
  const msg = $('#usage-chart-msg');
  const days = Number(/** @type {HTMLSelectElement} */ ($('#usage-chart-range')).value) || 0;
  try {
    usageChartData = await call(api.usageCharts({ days }));
    renderUsageChart();
  } catch (e) { msg.textContent = ''; $('#usage-chart').replaceChildren(el('div', { class: 'err', text: e.message })); }
}

function renderUsageChart() {
  $('#usage-linekind').classList.toggle('hidden', usageChartType !== 'line');
  if (usageChartType === 'bar') renderUsageBars();
  else renderUsageLine();
}

/** Horizontal quota bars: a block per provider, brand-tinted logo + a bar per window. */
function renderUsageBars() {
  const wrap = $('#usage-chart'); const legend = $('#usage-legend');
  legend.replaceChildren();
  const data = usageChartData || {};
  const rows = data.quota || [];
  if (!rows.length) { wrap.replaceChildren(el('div', { class: 'empty', text: t('usage.noQuota') })); return; }
  const accounts = Object.fromEntries((data.accounts || []).map((a) => [a.provider, a]));
  const byProv = {};
  for (const r of rows) (byProv[r.provider] ||= []).push(r);
  const order = (p) => (p === 'claude' ? 0 : p === 'codex' ? 1 : 2);
  const providers = Object.keys(byProv).sort((a, b) => order(a) - order(b));
  wrap.replaceChildren(...providers.map((p) => {
    const m = provMeta(p); const acct = accounts[p] || {};
    const wins = byProv[p].slice().sort((a, b) =>
      (WINDOW_ORDER[windowKind(a)] ?? 9) - (WINDOW_ORDER[windowKind(b)] ?? 9));
    const head = el('div', { class: 'uphead ' + m.brand },
      logo(m.icon, 'uplogo'),
      el('span', { class: 'upname', text: m.label }),
      el('span', { class: 'upmeta', text: acct.plan_type ? acct.plan_type : '' }));
    const bars = wins.flatMap((w) => {
      const kind = windowKind(w);
      const pct = w.used_percent == null ? 0 : Math.max(0, Math.min(100, w.used_percent));
      const track = el('div', { class: 'bar-track' },
        svgEl('svg', { viewBox: '0 0 100 14', preserveAspectRatio: 'none' },
          svgEl('rect', { x: 0, y: 0, width: pct.toFixed(2), height: 14, fill: windowColor(p, kind) })));
      const out = [el('div', { class: 'qbar' },
        el('div', { class: 'qlabel', text: windowLabel(kind) }),
        track,
        el('div', { class: 'qpct', text: w.used_percent == null ? '—' : `${Math.round(w.used_percent)}%` }))];
      if (w.resets_at) out.push(el('div', { class: 'qbar' },
        el('div', {}), el('div', { class: 'qreset', text: t('usage.resets', { time: fmtTime(w.resets_at) }) }), el('div', {})));
      return out;
    });
    return el('div', { class: 'usage-provider' }, head, ...bars);
  }));
}

/** Switchable line chart: quota-% trend, or daily token consumption. */
function renderUsageLine() {
  const wrap = $('#usage-chart'); const legend = $('#usage-legend');
  const data = usageChartData || {};
  /** @type {{key:string,label:string,color:string,brand:string,icon:string,pts:[number,number][]}[]} */
  let series = []; let opts;

  if (usageLineKind === 'quota') {
    const hist = (data.quotaHistory || []).filter((r) => r.used_percent != null);
    const groups = {};
    for (const r of hist) {
      const kind = windowKind(r); const key = `${r.provider}:${kind}`;
      (groups[key] ||= { provider: r.provider, kind, pts: [] }).pts.push([r.captured_at, r.used_percent]);
    }
    const ts = hist.map((r) => r.captured_at);
    const xMin = Math.min(...ts), xMax = Math.max(...ts);
    series = Object.values(groups).map((g) => ({
      key: `${g.provider}:${g.kind}`, label: `${provMeta(g.provider).label} ${windowLabel(g.kind)}`,
      color: windowColor(g.provider, g.kind), brand: provMeta(g.provider).brand, icon: provMeta(g.provider).icon,
      pts: g.pts.sort((a, b) => a[0] - b[0]),
    }));
    opts = { xMin, xMax, yMin: 0, yMax: 100, yTicks: [0, 25, 50, 75, 100], yFmt: (v) => `${v}%`, xFmt: fmtDay };
  } else {
    const daily = data.daily || [];
    const groups = {};
    for (const r of daily) (groups[r.provider] ||= []).push(r);
    const days = [...new Set(daily.map((r) => r.day))].sort();
    const idx = Object.fromEntries(days.map((d, i) => [d, i]));
    let maxTok = 0;
    series = Object.keys(groups).map((p) => {
      const pts = groups[p].map((r) => { maxTok = Math.max(maxTok, r.total_tokens); return [idx[r.day], r.total_tokens]; });
      return { key: p, label: provMeta(p).label, color: provMeta(p).color, brand: provMeta(p).brand,
        icon: provMeta(p).icon, pts: pts.sort((a, b) => a[0] - b[0]) };
    });
    const yMax = niceMax(maxTok);
    opts = { xMin: 0, xMax: Math.max(1, days.length - 1), yMin: 0, yMax,
      yTicks: [0, yMax / 2, yMax], yFmt: fmtTokens, xFmt: (i) => fmtDay(days[Math.round(i)]), xIsIndex: true };
  }

  const hasData = series.some((s) => s.pts.length);
  if (!hasData) { wrap.replaceChildren(el('div', { class: 'empty', text: t('usage.noChart') })); legend.replaceChildren(); return; }
  wrap.replaceChildren(lineChart(series, opts));
  legend.replaceChildren(...series.filter((s) => s.pts.length).map((s) => el('span', { class: 'lg ' + s.brand },
    svgEl('svg', { class: 'sw', viewBox: '0 0 12 12' }, svgEl('rect', { x: 0, y: 0, width: 12, height: 12, rx: 3, fill: s.color })),
    el('span', { text: s.label }))));
}

const fmtDay = (d) => {
  if (d == null) return '';
  const date = typeof d === 'number' ? new Date(d) : new Date(d + 'T00:00:00');
  return new Intl.DateTimeFormat(LANG, { month: 'numeric', day: 'numeric' }).format(date);
};
/** Round a max value up to a clean 1/2/5 × 10ⁿ tick so the axis reads nicely. */
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Render series as an SVG line chart with gridlines, y/x ticks, and per-point dots. */
function lineChart(series, opts) {
  const W = 640, H = 240, L = 48, R = 16, T = 14, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const sx = (x) => L + (opts.xMax === opts.xMin ? 0.5 : (x - opts.xMin) / (opts.xMax - opts.xMin)) * pw;
  const sy = (y) => T + (1 - (y - opts.yMin) / (opts.yMax - opts.yMin || 1)) * ph;
  const svg = svgEl('svg', { class: 'chart-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Y gridlines + labels
  for (const yt of opts.yTicks) {
    const y = sy(yt);
    svg.append(svgEl('line', { class: 'grid', x1: L, y1: y.toFixed(1), x2: W - R, y2: y.toFixed(1) }));
    svg.append(svgEl('text', { class: 'axis-text', x: L - 6, y: (y + 3.5).toFixed(1), 'text-anchor': 'end' }, document.createTextNode(opts.yFmt(yt))));
  }
  // X tick labels — sample up to 6 evenly spaced positions across the domain.
  const xticks = [];
  const span = opts.xMax - opts.xMin;
  const steps = Math.min(6, Math.max(1, opts.xIsIndex ? opts.xMax : 5));
  for (let i = 0; i <= steps; i++) {
    const xv = opts.xMin + (span * i) / steps;
    xticks.push(xv);
  }
  for (const xv of [...new Set(xticks)]) {
    svg.append(svgEl('text', { class: 'axis-text', x: sx(xv).toFixed(1), y: H - 10, 'text-anchor': 'middle' },
      document.createTextNode(opts.xFmt(xv))));
  }
  // Series polylines + dots
  for (const s of series) {
    if (!s.pts.length) continue;
    const pts = s.pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
    svg.append(svgEl('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    for (const [x, y] of s.pts) {
      const c = svgEl('circle', { class: 'dot', cx: sx(x).toFixed(1), cy: sy(y).toFixed(1), r: s.pts.length > 40 ? 1.5 : 3, fill: s.color });
      c.append(svgEl('title', {}, document.createTextNode(`${s.label}: ${opts.yFmt(Math.round(y))}`)));
      svg.append(c);
    }
  }
  return svg;
}

// chart-type toggle (bar / line) — re-renders from already-loaded data, no refetch.
$$('#usage-charttype button').forEach((b) => b.addEventListener('click', () => {
  usageChartType = /** @type {string} */ (b.dataset.charttype);
  $$('#usage-charttype button').forEach((x) => x.classList.toggle('active', x === b));
  renderUsageChart();
}));
$$('#usage-linekind button').forEach((b) => b.addEventListener('click', () => {
  usageLineKind = /** @type {string} */ (b.dataset.linekind);
  $$('#usage-linekind button').forEach((x) => x.classList.toggle('active', x === b));
  renderUsageChart();
}));
$('#usage-chart-range').addEventListener('change', loadStatusUsage);
$('#usage-chart-sync').addEventListener('click', async () => {
  const btn = /** @type {HTMLButtonElement} */ ($('#usage-chart-sync')); const msg = $('#usage-chart-msg');
  btn.disabled = true; msg.className = 'muted'; msg.textContent = t('usage.syncing');
  try { await call(api.syncUsage()); flash(msg, t('usage.done'), false); await loadStatusUsage(); }
  catch (e) { flash(msg, e.message, true); }
  finally { btn.disabled = false; }
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

// --- CHAT ---------------------------------------------------------------------
// A deterministic command console. sendMessage() is the single seam a real LLM/agent
// backend replaces later — the bubble UI, composer, and quick actions stay as-is.

// Renderer mirror of main.js CONSOLE_CMDS (main is the real gate). Only the chat-useful ones.
const CONSOLE_CMDS_UI = ['status', 'sweep', 'brief', 'dashboard', 'actions', 'tasks', 'traces', 'catalog', 'usage-summary'];
let chatBooted = false;

/** Append a chat bubble and return its node (so a pending bubble can be filled in later). */
function bubble(role, content) {
  const b = el('div', { class: 'bubble ' + role });
  if (content != null) b.append(/** @type {any} */ (content).nodeType ? content : document.createTextNode(String(content)));
  const log = $('#chat-log');
  log.append(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

/** Summarize a command's result as a node (rather than dumping raw JSON). */
function renderResult(cmd, data) {
  if (data == null) return el('span', { text: t('chat.empty') });
  if (cmd === 'status') {
    const ba = data.findings?.byAction || {};
    const cost = data.cost?.latestUsd != null ? `~$${data.cost.latestUsd}` : '—';
    return el('span', { text: `${data.findings?.open ?? 0} open · ${(ba.push || 0) + (ba.escalate || 0)} push/escalate · ${data.pending?.length ?? 0} pending · ${cost}` });
  }
  if (cmd === 'sweep') {
    const skipped = data.skipped?.length ? t('status.skipped', { list: data.skipped.join(', ') }) : '';
    return el('span', { text: t('status.sweepDone', { findings: data.counts?.findings ?? 0, hot: data.hot?.length ?? 0, skipped }) });
  }
  if (cmd === 'brief') return el('pre', { text: data.markdown || t('chat.empty') });
  if (cmd === 'actions') {
    if (!data.length) return el('span', { text: t('actions.none') });
    return el('div', {}, ...data.map((a) => el('div', { text: '• ' + (a.kind || '?') + (a.rationale ? ' — ' + a.rationale : '') })));
  }
  if (cmd === 'usage-summary') {
    const tot = (data.totals || []).map((x) => `${x.provider}: ${fmtTokens(x.total_tokens)}`).join(' · ');
    return el('span', { text: tot || t('chat.empty') });
  }
  if (cmd === 'dashboard' && data.path) return el('span', { text: data.path });
  if (Array.isArray(data)) return el('span', { text: `${data.length}` });
  return el('pre', { text: JSON.stringify(data, null, 2) });
}

async function sendMessage(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  const cmd = trimmed.split(/\s+/)[0].toLowerCase();
  bubble('user', trimmed);
  const list = CONSOLE_CMDS_UI.join(', ');
  if (!CONSOLE_CMDS_UI.includes(cmd)) { bubble('guai', t('chat.unknown', { cmd, list })); return; }
  const pending = bubble('guai', t('chat.running', { cmd }));
  try {
    const data = await call(api.runControl(cmd)); // ← the seam an agent backend replaces later
    pending.replaceChildren(renderResult(cmd, data));
  } catch (e) {
    pending.replaceChildren(el('div', { class: 'err', text: e.message }));
  }
  const log = $('#chat-log'); log.scrollTop = log.scrollHeight;
}

function loadChat() {
  if (!chatBooted) { bubble('guai', t('chat.welcome', { list: CONSOLE_CMDS_UI.join(', ') })); chatBooted = true; }
}

$('#chat-send').addEventListener('click', () => { const inp = /** @type {HTMLInputElement} */ ($('#chat-input')); sendMessage(inp.value); inp.value = ''; });
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const inp = /** @type {HTMLInputElement} */ (e.target); sendMessage(inp.value); inp.value = ''; }
});
$$('.qa').forEach((b) => b.addEventListener('click', () => sendMessage(/** @type {string} */ (b.dataset.cmd))));

// --- JOBS ---------------------------------------------------------------------
// Edits mutate an in-memory working copy of config.jobs; "Save jobs" persists the array.

const JOB_MODEL_TIERS = ['opus', 'sonnet', 'haiku'];
const JOB_MODES = ['active', 'passive', 'scheduled'];
const JOB_MODE_CHIP = { active: 'a-push', passive: 'a-store', scheduled: 'a-digest' };
/** @type {any[]|null} */ let jobsState = null;
let selectedJobIdx = -1;

async function loadJobs() {
  try { jobsState = await call(api.getJobs()); }
  catch (e) { $('#job-list').replaceChildren(el('div', { class: 'err', text: e.message })); return; }
  if (selectedJobIdx < 0 && jobsState.length) selectedJobIdx = 0;
  if (selectedJobIdx >= jobsState.length) selectedJobIdx = jobsState.length - 1;
  renderJobList(); renderJobEditor();
}

function renderJobList() {
  const wrap = $('#job-list');
  if (!jobsState) return;
  wrap.replaceChildren(...jobsState.map((j, i) => el('div', {
    class: 'job-list-item' + (i === selectedJobIdx ? ' active' : ''),
    onclick: () => { selectedJobIdx = i; renderJobList(); renderJobEditor(); },
  }, el('div', { class: 'name', text: j.name || t('jobs.newName') }),
    chip(t('jobs.badge.' + j.mode), JOB_MODE_CHIP[j.mode] || 'a-store'))));
}

async function persistJobs() {
  const msg = $('#jobs-msg');
  try { await call(api.saveJobs(jobsState)); flash(msg, t('jobs.saved'), false); }
  catch (e) { flash(msg, t('jobs.failed', { msg: e.message }), true); }
}

function renderJobEditor() {
  const wrap = $('#job-editor');
  if (!jobsState || selectedJobIdx < 0 || !jobsState[selectedJobIdx]) {
    wrap.replaceChildren(el('div', { class: 'empty', text: t('jobs.empty') }));
    return;
  }
  const j = jobsState[selectedJobIdx];

  const nameInput = el('input', { type: 'text' });
  /** @type {HTMLInputElement} */ (nameInput).value = j.name || '';
  nameInput.addEventListener('input', () => { j.name = /** @type {HTMLInputElement} */ (nameInput).value; renderJobList(); });

  const descInput = el('textarea', {});
  /** @type {HTMLTextAreaElement} */ (descInput).value = j.description || '';
  descInput.addEventListener('input', () => { j.description = /** @type {HTMLTextAreaElement} */ (descInput).value; });

  const modelSelect = el('select', { class: 'lang-select' }, ...JOB_MODEL_TIERS.map((m) => el('option', { value: m, text: m })));
  /** @type {HTMLSelectElement} */ (modelSelect).value = j.model || 'sonnet';
  /** @type {HTMLSelectElement} */ (modelSelect).disabled = j.model === null;
  modelSelect.addEventListener('change', () => { j.model = /** @type {HTMLSelectElement} */ (modelSelect).value; });

  const autoInput = el('input', { type: 'checkbox' });
  /** @type {HTMLInputElement} */ (autoInput).checked = j.model === null;
  autoInput.addEventListener('change', () => {
    const on = /** @type {HTMLInputElement} */ (autoInput).checked;
    if (on) { j.model = null; /** @type {HTMLSelectElement} */ (modelSelect).disabled = true; }
    else { j.model = /** @type {HTMLSelectElement} */ (modelSelect).value || 'sonnet'; /** @type {HTMLSelectElement} */ (modelSelect).disabled = false; }
  });
  const autoToggle = el('label', { class: 'switch' }, autoInput, el('span', { class: 'slider' }));

  const seg = el('div', { class: 'segmented' }, ...JOB_MODES.map((m) => el('button', {
    class: j.mode === m ? 'active' : '', text: t('jobs.mode.' + m),
    onclick: () => { j.mode = m; renderJobEditor(); renderJobList(); },
  })));

  const cronInput = el('input', { type: 'text' });
  /** @type {HTMLInputElement} */ (cronInput).value = j.cron || '';
  cronInput.addEventListener('input', () => { j.cron = /** @type {HTMLInputElement} */ (cronInput).value || null; });

  const subWrap = el('div', {});
  const renderSubs = () => {
    subWrap.replaceChildren(...(j.subtasks || []).map((s, k) => {
      const cb = el('input', { type: 'checkbox' });
      /** @type {HTMLInputElement} */ (cb).checked = !!s.done;
      cb.addEventListener('change', () => { s.done = /** @type {HTMLInputElement} */ (cb).checked; });
      const txt = el('input', { type: 'text' });
      /** @type {HTMLInputElement} */ (txt).value = s.text || '';
      txt.addEventListener('input', () => { s.text = /** @type {HTMLInputElement} */ (txt).value; });
      const rm = el('button', { class: 'remove', onclick: () => { j.subtasks.splice(k, 1); renderSubs(); } }, icon('ic-x'));
      return el('div', { class: 'subtask-row' }, cb, txt, rm);
    }));
  };
  renderSubs();
  const addSub = el('button', { class: 'ghost icon-btn', onclick: () => { (j.subtasks ||= []).push({ text: '', done: false }); renderSubs(); } },
    icon('ic-add'), el('span', { text: t('jobs.addSubtask') }));

  const form = el('div', { class: 'form' },
    el('label', { text: t('jobs.name') }), nameInput,
    el('label', { text: t('jobs.description') }), descInput,
    el('label', { text: t('jobs.model') }), el('div', { class: 'row' }, modelSelect, autoToggle, el('span', { class: 'muted', text: t('jobs.modelAuto') })),
    el('label', { text: t('jobs.mode') }), seg,
    ...(j.mode === 'scheduled' ? [el('label', { text: t('jobs.cron') }), cronInput] : []),
    el('label', { text: t('jobs.subtasks') }), el('div', {}, subWrap, addSub));

  wrap.replaceChildren(form, el('div', { class: 'row' }, el('button', { class: 'primary', onclick: persistJobs }, t('jobs.save'))));
}

$('#job-add').addEventListener('click', () => {
  if (!jobsState) jobsState = [];
  jobsState.push({ id: 'job-' + Date.now(), name: t('jobs.newName'), description: '', model: null, mode: 'active', cron: null, subtasks: [] });
  selectedJobIdx = jobsState.length - 1;
  renderJobList(); renderJobEditor();
});

// --- boot ---------------------------------------------------------------------

$('#lang-select').addEventListener('change', (e) => setLang(/** @type {HTMLSelectElement} */ (e.target).value, true));
api.onRefreshed(() => {
  if (document.body.classList.contains('settings-open')) { if (lastSettings === 'usage') loadUsage(); return; }
  if (lastTab === 'status') activateStatusSub(lastStatusSub);
});

(async function boot() {
  try {
    const cfg = await call(api.getConfig());
    LANG = cfg?.ui?.language === 'zh-TW' ? 'zh-TW' : 'en';
  } catch { /* default to English if config can't be read */ }
  /** @type {HTMLSelectElement} */ ($('#lang-select')).value = LANG;
  applyI18n();
  activate('chat');
  // Set the armed badge correctly before Status is opened (Chat is the default view).
  try { const s = await call(api.status()); setArmed(s.taskScheduler?.installed || s.schedule?.enabled); } catch { /* badge stays idle */ }
})();
