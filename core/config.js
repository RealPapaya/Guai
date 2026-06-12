// Config + secrets + canonical paths. Secrets come from env vars first, then an
// optional gitignored state/secrets.json — never from committed config.
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root: ROOT,
  config: join(ROOT, 'config', 'guai.config.json'),
  models: join(ROOT, 'config', 'models.json'),
  db: join(ROOT, 'state', 'guai.db'),
  inbox: join(ROOT, 'state', 'inbox'),
  snapshots: join(ROOT, 'state', 'snapshots'),
  dashboard: join(ROOT, 'state', 'dashboard.html'),
  fixtures: join(ROOT, 'test', 'fixtures'),
  templates: join(ROOT, 'comms', 'templates'),
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadConfig() {
  return readJson(paths.config);
}

export function loadModels() {
  return readJson(paths.models);
}

/** The domains the GUI can independently arm. dev/cost are deterministic (core),
 *  email/calendar are the CC-layer monitors (workflows/sweep.workflow.js). */
export const MONITOR_DOMAINS = ['dev', 'cost', 'email', 'calendar'];

/** UI languages the desktop control panel ships translations for. */
export const UI_LANGUAGES = ['en', 'zh-TW'];

/** Token-style secrets the Accounts page may manage in state/secrets.json.
 *  Gmail/Calendar are deliberately absent — they use the Claude Code MCP OAuth
 *  handshake, so no token is stored locally. */
export const SECRET_NAMES = ['GITHUB_TOKEN', 'LINE_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GUAI_SIDECAR_TOKEN'];

/** A disabled flag must be EXPLICITLY false — absent/unknown defaults to enabled,
 *  so an older config (no `monitors` block) keeps monitoring everything. */
export function monitorEnabled(cfg, domain) {
  return cfg?.monitors?.[domain] !== false;
}

/**
 * Validate a candidate config before it's persisted. Returns {ok, errors:[...]}.
 * Cheap structural + range checks — the gate stays the real arbiter; this only
 * stops the GUI from writing a config that would crash a sweep.
 * @param {object} cfg
 */
export function validateConfig(cfg) {
  const errors = [];
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const numIn = (path, v, lo, hi) => {
    if (!num(v)) errors.push(`${path} must be a number`);
    else if (v < lo || v > hi) errors.push(`${path} must be between ${lo} and ${hi}`);
  };

  if (!isObj(cfg)) return { ok: false, errors: ['config must be an object'] };

  if (cfg.monitors !== undefined) {
    if (!isObj(cfg.monitors)) errors.push('monitors must be an object');
    else for (const d of MONITOR_DOMAINS) {
      if (cfg.monitors[d] !== undefined && typeof cfg.monitors[d] !== 'boolean')
        errors.push(`monitors.${d} must be a boolean`);
    }
  }

  if (cfg.ui !== undefined) {
    if (!isObj(cfg.ui)) errors.push('ui must be an object');
    else if (cfg.ui.language !== undefined && !UI_LANGUAGES.includes(cfg.ui.language))
      errors.push(`ui.language must be one of ${UI_LANGUAGES.join('|')}`);
  }

  if (cfg.schedule !== undefined) {
    const s = cfg.schedule;
    if (!isObj(s)) errors.push('schedule must be an object');
    else {
      if (s.enabled !== undefined && typeof s.enabled !== 'boolean') errors.push('schedule.enabled must be a boolean');
      if (s.durable !== undefined && typeof s.durable !== 'boolean') errors.push('schedule.durable must be a boolean');
      if (s.weekdaysOnly !== undefined && typeof s.weekdaysOnly !== 'boolean') errors.push('schedule.weekdaysOnly must be a boolean');
      if (s.dailyBriefHour !== undefined) numIn('schedule.dailyBriefHour', s.dailyBriefHour, 0, 23);
      if (s.dailyBriefMinute !== undefined) numIn('schedule.dailyBriefMinute', s.dailyBriefMinute, 0, 59);
      if (s.sweepEveryMinutes !== undefined) numIn('schedule.sweepEveryMinutes', s.sweepEveryMinutes, 5, 1440);
    }
  }

  if (cfg.quietHours !== undefined) {
    if (!isObj(cfg.quietHours)) errors.push('quietHours must be an object');
    else { numIn('quietHours.start', cfg.quietHours.start, 0, 23); numIn('quietHours.end', cfg.quietHours.end, 0, 23); }
  }

  if (cfg.push !== undefined) {
    const p = cfg.push;
    if (!isObj(p)) errors.push('push must be an object');
    else {
      if (p.maxPerHour !== undefined) numIn('push.maxPerHour', p.maxPerHour, 0, 100);
      if (p.maxPerDay !== undefined) numIn('push.maxPerDay', p.maxPerDay, 0, 1000);
      if (p.cooldownMinutesPerFingerprint !== undefined) numIn('push.cooldownMinutesPerFingerprint', p.cooldownMinutesPerFingerprint, 0, 10080);
      if (p.maxChars !== undefined) numIn('push.maxChars', p.maxChars, 20, 2000);
    }
  }

  if (cfg.gate !== undefined) {
    const g = cfg.gate;
    if (!isObj(g)) errors.push('gate must be an object');
    else {
      if (g.pushThreshold !== undefined) numIn('gate.pushThreshold', g.pushThreshold, 0, 100);
      if (g.urgentWindowHours !== undefined) numIn('gate.urgentWindowHours', g.urgentWindowHours, 0, 720);
    }
  }

  if (cfg.github !== undefined) {
    const gh = cfg.github;
    if (!isObj(gh)) errors.push('github must be an object');
    else if (gh.repos !== undefined) {
      if (!Array.isArray(gh.repos)) errors.push('github.repos must be an array');
      else gh.repos.forEach((r, i) => {
        if (typeof r !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(r)) errors.push(`github.repos[${i}] must look like "owner/name"`);
      });
    }
  }

  if (cfg.cost !== undefined) {
    const c = cfg.cost;
    if (!isObj(c)) errors.push('cost must be an object');
    else {
      if (c.monthlyBudgetUsd !== undefined) numIn('cost.monthlyBudgetUsd', c.monthlyBudgetUsd, 0, 1e7);
      if (c.expectedDailyUsd !== undefined) numIn('cost.expectedDailyUsd', c.expectedDailyUsd, 0, 1e6);
    }
  }

  if (cfg.sidecar !== undefined) {
    const s = cfg.sidecar;
    if (!isObj(s)) errors.push('sidecar must be an object');
    else {
      if (s.enabled !== undefined && typeof s.enabled !== 'boolean') errors.push('sidecar.enabled must be a boolean');
      if (s.baseUrl !== undefined && (typeof s.baseUrl !== 'string' || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(s.baseUrl)))
        errors.push('sidecar.baseUrl must be a localhost HTTP URL');
      if (s.timeoutMs !== undefined) numIn('sidecar.timeoutMs', s.timeoutMs, 1000, 3600000);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate then atomically persist the config. Writes to a temp file and renames,
 * so a crash mid-write can't leave a half-written config that breaks every sweep.
 * @param {object} cfg
 * @returns {{ok:true}}  on success; throws an Error listing problems on invalid input.
 */
export function saveConfig(cfg) {
  const { ok, errors } = validateConfig(cfg);
  if (!ok) throw new Error('Invalid config:\n  - ' + errors.join('\n  - '));
  const tmp = paths.config + '.tmp';
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  renameSync(tmp, paths.config);
  return { ok: true };
}

const SECRETS_FILE = join(ROOT, 'state', 'secrets.json');

function fileSecrets() {
  return existsSync(SECRETS_FILE) ? readJson(SECRETS_FILE) : {};
}

/** Env var wins over the optional secrets file. */
export function secret(name) {
  return process.env[name] ?? fileSecrets()[name] ?? null;
}

export function githubToken() {
  return secret('GITHUB_TOKEN');
}

/**
 * Whether a secret is configured and where from — WITHOUT exposing its value.
 * The desktop Accounts page only ever sees {set, source}; the raw token never
 * crosses the bridge to the (sandboxed) renderer.
 * @param {string} name
 * @returns {{set:boolean, source:('env'|'file'|null)}}
 */
export function secretStatus(name) {
  const env = process.env[name];
  if (env != null && String(env).trim() !== '') return { set: true, source: 'env' };
  const fromFile = fileSecrets()[name];
  if (fromFile != null && String(fromFile).trim() !== '') return { set: true, source: 'file' };
  return { set: false, source: null };
}

/**
 * Merge-write a token into state/secrets.json (atomic temp+rename). A blank/empty
 * value DELETES the key. Only known SECRET_NAMES are accepted. Preserves any other
 * keys already in the file (e.g. its _comment). Does NOT touch env vars — if the
 * same name is set in the environment, that still wins at read time.
 * @param {string} name
 * @param {string|null|undefined} value
 * @returns {{ok:true, source:('env'|'file'|null)}}
 */
export function setFileSecret(name, value) {
  if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret "${name}". Allowed: ${SECRET_NAMES.join(', ')}`);
  const current = fileSecrets();
  const trimmed = value == null ? '' : String(value).trim();
  if (trimmed === '') delete current[name];
  else current[name] = trimmed;
  const tmp = SECRETS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, SECRETS_FILE);
  return { ok: true, source: secretStatus(name).source };
}
