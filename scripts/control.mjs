// @ts-check
// The control bridge: the SINGLE JSON-in / JSON-out surface between the Electron
// desktop app (desktop/) and the portable core. The renderer never touches Node, fs,
// or sqlite — the main process spawns `node scripts/control.mjs <cmd>` and pipes JSON.
//
// Contract: stdout is ALWAYS a single bare JSON value (the result). Errors go to
// stderr as a JSON {error} line and exit code 1. Each invocation opens the DB, does
// one unit of work, and closes — so SQLite stays effectively single-writer (WAL +
// busy_timeout=5000 serialize any overlap with a concurrent cron/Task run).
//
// Commands:
//   status                          live control-panel snapshot
//   monitors                        bare {dev,cost,email,calendar} flags (also read by the sweep workflow)
//   monitors-set --domain= --enabled=   toggle one domain, returns the new flags
//   config-get                      full config object
//   config-set        (stdin=JSON)  validate + atomically persist a whole config
//   sweep [--dry]                   run the deterministic dev+cost sweep now
//   brief [--save]                  render the (LLM-free) morning brief markdown
//   daily                           sweep + brief in one shot (what the durable task runs)
//   dashboard                       (re)render state/dashboard.html, return its path
//   actions                         pending propose-and-confirm actions
//   decide --id= --status=          record an action decision (records only; never executes)
//   schedule-get                    config.schedule + real Windows Task Scheduler state
//   schedule-set      (stdin=JSON)  persist schedule + install/remove the durable task
//   secrets-get                     per-token {set,source} status — NEVER the raw values
//   secrets-set       (stdin=JSON)  {name,value} → write/clear a token in state/secrets.json
//   jobs-get                        config.jobs, or jobs seeded from .claude/agents/* if unset
//   jobs-set          (stdin=JSON)  validate + persist the jobs array (config.jobs)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openMemory } from '../core/memory.js';
import {
  loadConfig, saveConfig, monitorEnabled, MONITOR_DOMAINS, paths, githubToken,
  SECRET_NAMES, secretStatus, setFileSecret, JOB_MODELS,
} from '../core/config.js';
import { runSweep } from '../core/sweep.js';
import { buildBriefModel, renderBrief } from '../core/render/brief.js';
import { renderDashboard } from '../core/render/dashboard.js';
import { SidecarClient } from '../core/sidecar.js';
import { syncUsage } from '../core/usage.js';

const TASK_NAME = 'Guai-DailyBrief';
const DAILY_CMD = join(paths.root, 'state', 'guai-daily.cmd');
// Capture (don't inherit) child stderr so schtasks' "task not found" message can't
// leak into our stderr, and hide the transient console window on Windows.
const SCHTASKS_OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };

const args = process.argv.slice(2);
const cmd = args[0];
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + '=')); return a ? a.split('=').slice(1).join('=') : null; };

// Set exitCode + return rather than process.exit(): exit() can truncate piped
// stdout before the GUI reads it, and would skip the mem.close() in finally.
/** Print one bare JSON value to stdout (exit 0). */
function ok(value) {
  process.stdout.write(JSON.stringify(value));
  return value;
}
/** Print {error} to stderr and flag exit 1. */
function fail(message, extra = {}) {
  process.stderr.write(JSON.stringify({ error: String(message), ...extra }));
  process.exitCode = 1;
  return undefined;
}
const readStdin = () => readFileSync(0, 'utf8');

// ---- monitors (domain arming) ----------------------------------------------

function monitorsFlags(cfg) {
  const out = {};
  for (const d of MONITOR_DOMAINS) out[d] = monitorEnabled(cfg, d);
  return out;
}

// ---- secrets (token accounts; values stay server-side) ----------------------

/** {NAME: {set, source}} for every manageable token. Never includes raw values. */
function secretsStatusAll() {
  const out = {};
  for (const name of SECRET_NAMES) out[name] = secretStatus(name);
  return out;
}

// ---- jobs (the desktop "Jobs" tab; autonomy units backed by config.jobs) -----

// Sensible default execution mode per seeded agent. Monitors run inside the sweep
// (passive), the brief composer is scheduled, orchestration/research are on-demand (active).
const AGENT_DEFAULT_MODE = {
  'chief-of-staff': 'active', researcher: 'active', 'digest-writer': 'scheduled',
  'dev-watcher': 'passive', 'cost-monitor': 'passive', 'inbox-triage': 'passive', 'calendar-aide': 'passive',
};

/** Pull name/description/model from an agent markdown's `---` frontmatter (no YAML dep). */
function parseAgentFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/** Seed Jobs from .claude/agents/*.md. Returns jobs WITHOUT persisting — first save persists. */
function seedJobsFromAgents() {
  const dir = join(paths.root, '.claude', 'agents');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; }
  const jobs = [];
  for (const f of files.sort()) {
    const fm = parseAgentFrontmatter(readFileSync(join(dir, f), 'utf8'));
    const name = fm.name || f.replace(/\.md$/, '');
    jobs.push({
      id: name,
      name,
      description: fm.description || '',
      model: JOB_MODELS.includes(fm.model) ? fm.model : null,
      mode: AGENT_DEFAULT_MODE[name] || 'passive',
      cron: null,
      subtasks: [],
    });
  }
  return jobs;
}

// ---- Windows Task Scheduler (durable "even when app closed") ----------------

function taskQuery() {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  try {
    const out = execFileSync('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST', '/V'], SCHTASKS_OPTS);
    const field = (label) => { const m = out.match(new RegExp(`^${label}:\\s*(.+)$`, 'm')); return m ? m[1].trim() : null; };
    return { supported: true, installed: true, nextRun: field('Next Run Time'), status: field('Status') };
  } catch {
    return { supported: true, installed: false }; // schtasks exits non-zero when the task doesn't exist
  }
}

function taskInstall(hour, minute) {
  if (process.platform !== 'win32') throw new Error('Durable scheduling needs Windows Task Scheduler (this is not win32).');
  // A tiny launcher batch so the task command stays short and cwd is correct. Embed the
  // absolute node path (process.execPath) so the task doesn't depend on Task Scheduler's PATH.
  const bat = `@echo off\r\ncd /d "${paths.root}"\r\n"${process.execPath}" "${join(paths.root, 'scripts', 'control.mjs')}" daily >> "${join(paths.root, 'state', 'guai-daily.log')}" 2>&1\r\n`;
  writeFileSync(DAILY_CMD, bat);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  // /F overwrites; runs as the current user (no admin needed for a per-user task).
  execFileSync('schtasks', ['/Create', '/F', '/TN', TASK_NAME, '/SC', 'DAILY', '/ST', `${hh}:${mm}`, '/TR', DAILY_CMD], SCHTASKS_OPTS);
}

function taskRemove() {
  if (process.platform !== 'win32') return;
  try { execFileSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], SCHTASKS_OPTS); }
  catch { /* not installed — nothing to remove */ }
}

// ---- deterministic work ------------------------------------------------------

async function doSweep(mem, cfg, { dry }) {
  const repos = cfg.github?.repos ?? [];
  const res = await runSweep(mem, cfg, { repos, dry, token: githubToken(), trigger: 'gui' });
  const hot = res.decided
    .filter((d) => d.gate_action === 'push' || d.gate_action === 'escalate')
    .map((f) => ({ title: f.title, action: f.gate_action, priority: f.priority, ev: f.ev_score, source: f.source }));
  return { counts: res.counts, skipped: res.skipped, errors: res.errors, hot };
}

function doBrief(mem, cfg, { save }) {
  const md = renderBrief(buildBriefModel(mem, cfg), cfg);
  let savedTo = null;
  if (save) { savedTo = join(paths.root, 'state', 'brief-latest.md'); writeFileSync(savedTo, md); }
  return { markdown: md, savedTo };
}

function doDashboard(mem, cfg) {
  const html = renderDashboard(mem.snapshot(), cfg);
  writeFileSync(paths.dashboard, html);
  return { path: paths.dashboard };
}

function statusPayload(mem, cfg) {
  const open = mem.openFindings();
  const byAction = {};
  for (const f of open) byAction[f.gate_action] = (byAction[f.gate_action] ?? 0) + 1;
  const cost = mem.costSummary();
  return {
    monitors: monitorsFlags(cfg),
    schedule: cfg.schedule ?? null,
    findings: {
      open: open.length,
      byAction,
      top: open.slice(0, 12).map((f) => ({
        id: f.id, title: f.title, kind: f.kind, source: f.source,
        severity: f.severity, priority: f.priority, action: f.gate_action,
      })),
    },
    pending: mem.pendingActions().map((a) => ({
      id: a.id, kind: a.kind, rationale: a.rationale,
      summary: a.payload_json?.summary ?? null, proposed_at: a.proposed_at, expires_at: a.expires_at,
    })),
    projects: mem.activeProjects().map((p) => ({ id: p.id, name: p.name, status: p.status })),
    watchTargets: mem.watchTargets().length,
    investigations: mem.openInvestigations().length,
    cost: { latestUsd: cost.latest?.usd ?? null, baselineUsd: cost.baselineUsd ?? null },
    lastRun: mem.lastRunEndedAt() || null,
    lastBrief: mem.lastBriefTs() || null,
    taskScheduler: taskQuery(),
    delegated: {
      tasks: mem.agentTasks(12).map((t) => ({
        taskId: t.task_id, objective: t.objective, worker: t.worker,
        status: t.status, difficulty: t.difficulty, riskLevel: t.risk_level,
        updatedAt: t.updated_at,
      })),
      recentTraces: mem.executionTraces(12).map((t) => ({
        traceId: t.trace_id, taskId: t.task_id, worker: t.worker,
        status: t.status, recordedAt: t.recorded_at,
      })),
      catalogSize: mem.componentCatalog().length,
    },
  };
}

// ---- dispatch ----------------------------------------------------------------

async function main() {
  const cfg = loadConfig();

  // Commands that don't need the DB.
  if (cmd === 'monitors') return ok(monitorsFlags(cfg));
  if (cmd === 'config-get') return ok(cfg);
  if (cmd === 'monitors-set') {
    const domain = val('--domain');
    const enabled = val('--enabled');
    if (!MONITOR_DOMAINS.includes(domain)) return fail(`--domain must be one of ${MONITOR_DOMAINS.join('|')}`);
    if (enabled !== 'true' && enabled !== 'false') return fail('--enabled must be true|false');
    // Spread the existing monitors (not just the 4 known flags) so any custom/future key survives.
    const next = { ...cfg, monitors: { ...cfg.monitors, [domain]: enabled === 'true' } };
    saveConfig(next);
    return ok({ ok: true, monitors: monitorsFlags(next) });
  }
  if (cmd === 'config-set') {
    let incoming;
    try { incoming = JSON.parse(readStdin()); } catch (e) { return fail('stdin is not valid JSON: ' + e.message); }
    // Merge over the current config so a partial payload can't drop unrelated top-level keys.
    try { saveConfig({ ...cfg, ...incoming }); } catch (e) { return fail(e.message); }
    return ok({ ok: true });
  }
  if (cmd === 'jobs-get') return ok(Array.isArray(cfg.jobs) ? cfg.jobs : seedJobsFromAgents());
  if (cmd === 'jobs-set') {
    let incoming;
    try { incoming = JSON.parse(readStdin()); } catch (e) { return fail('stdin is not valid JSON: ' + e.message); }
    if (!Array.isArray(incoming)) return fail('jobs-set expects a JSON array of jobs');
    try { saveConfig({ ...cfg, jobs: incoming }); } catch (e) { return fail(e.message); }
    return ok({ ok: true, jobs: incoming });
  }
  if (cmd === 'secrets-get') return ok(secretsStatusAll());
  if (cmd === 'secrets-set') {
    let incoming;
    try { incoming = JSON.parse(readStdin()); } catch (e) { return fail('stdin is not valid JSON: ' + e.message); }
    const name = incoming?.name;
    if (!SECRET_NAMES.includes(name)) return fail(`name must be one of ${SECRET_NAMES.join('|')}`);
    try { setFileSecret(name, incoming.value); } catch (e) { return fail(e.message); }
    return ok({ ok: true, secrets: secretsStatusAll() });
  }
  if (cmd === 'schedule-get') {
    return ok({ schedule: cfg.schedule ?? null, taskScheduler: taskQuery() });
  }
  if (cmd === 'sidecar-health') {
    if (cfg.sidecar?.enabled === false) return fail('Worker sidecar is disabled in config.');
    return ok(await new SidecarClient(cfg.sidecar).health());
  }
  if (cmd === 'schedule-set') {
    let incoming;
    try { incoming = JSON.parse(readStdin()); } catch (e) { return fail('stdin is not valid JSON: ' + e.message); }
    const schedule = { ...(cfg.schedule ?? {}), ...incoming };
    // Mirror the brief time into config.brief (read by arm-cron.mjs for the CC-layer cron),
    // so the Schedule tab is the single source of truth for "when the daily brief fires".
    const brief = {
      ...(cfg.brief ?? {}),
      hour: schedule.dailyBriefHour ?? cfg.brief?.hour,
      minute: schedule.dailyBriefMinute ?? cfg.brief?.minute,
    };
    try { saveConfig({ ...cfg, schedule, brief }); } catch (e) { return fail(e.message); }
    let durable = { installed: false };
    try {
      if (schedule.enabled && schedule.durable) {
        taskInstall(schedule.dailyBriefHour ?? 7, schedule.dailyBriefMinute ?? 57);
        durable = taskQuery();
      } else {
        taskRemove();
        durable = taskQuery();
      }
    } catch (e) {
      // Persisted the intent; surface why the OS-level task couldn't be (un)installed.
      return ok({ ok: true, schedule, durable: { installed: false, error: e.message } });
    }
    return ok({ ok: true, schedule, durable });
  }

  // Commands that touch the DB.
  const mem = openMemory(paths.db);
  try {
    switch (cmd) {
      case 'status': return ok(statusPayload(mem, cfg));
      case 'sweep': return ok(await doSweep(mem, cfg, { dry: has('--dry') }));
      case 'brief': return ok(doBrief(mem, cfg, { save: has('--save') }));
      case 'dashboard': return ok(doDashboard(mem, cfg));
      case 'actions': return ok(mem.pendingActions());
      case 'tasks': return ok(mem.agentTasks());
      case 'traces': return ok(mem.executionTraces());
      case 'catalog': return ok(mem.componentCatalog());
      case 'usage-sync': return ok(await syncUsage(mem));
      case 'usage-summary': return ok(mem.usageSummary());
      case 'usage-sessions': return ok(mem.usageSessions({
        provider: val('--provider'),
        projectId: val('--project-id') ? Number(val('--project-id')) : null,
        since: val('--since') ? Number(val('--since')) : null,
        limit: val('--limit') ? Number(val('--limit')) : 200,
      }));
      case 'usage-session': {
        const provider = val('--provider');
        const id = val('--id');
        if (!provider || !id) return fail('Usage: usage-session --provider=claude|codex --id=SESSION_ID');
        return ok(mem.usageSession(provider, id));
      }
      case 'sidecar-sync': {
        if (cfg.sidecar?.enabled === false) return fail('Worker sidecar is disabled in config.');
        const catalog = await new SidecarClient(cfg.sidecar).catalog();
        return ok({ synced: mem.syncComponentCatalog(catalog), catalog });
      }
      case 'daily': {
        const sweep = await doSweep(mem, cfg, { dry: false });
        const brief = doBrief(mem, cfg, { save: true });
        doDashboard(mem, cfg);
        return ok({ sweep, briefSavedTo: brief.savedTo, hot: sweep.hot });
      }
      case 'decide': {
        const id = Number(val('--id'));
        const status = val('--status');
        if (!id || !['approved', 'rejected', 'executed', 'failed'].includes(status))
          return fail('Usage: decide --id=N --status=approved|rejected|executed|failed');
        mem.decideAction(id, status, null);
        return ok({ ok: true, id, status });
      }
      default:
        return fail(`Unknown command "${cmd ?? ''}". See the header of scripts/control.mjs for the list.`);
    }
  } finally {
    mem.close();
  }
}

main().catch((e) => fail(e.stack || e.message));
