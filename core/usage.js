// Subscription usage tracking for locally authenticated Claude Code and Codex CLIs.
// Session JSONL is the attribution source; provider quota endpoints/events are account totals.
import {
  existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, normalize, parse as parsePath, resolve } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const CLAUDE_ROOT = join(HOME, '.claude');
const CODEX_ROOT = join(HOME, '.codex');
const zero = () => ({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 });
const add = (a, b) => {
  for (const k of Object.keys(a)) a[k] += Number(b?.[k] ?? 0);
  return a;
};
const ts = (value) => {
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : null;
};
const epochMs = (value) => {
  const n = ts(value);
  return n != null && n > 0 && n < 10_000_000_000 ? n * 1000 : n;
};
const compactTitle = (value, fallback = 'Untitled session') => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 120);
};
const isInternalPrompt = (text) => /^<(environment_context|permissions|collaboration_mode|skills_instructions)\b/i.test(String(text ?? '').trim());
const hashRef = (value) => value ? createHash('sha256').update(String(value)).digest('hex').slice(0, 16) : null;

function jsonLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function filesUnder(root, accept) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && accept(full)) out.push(full);
    }
  };
  walk(root);
  return out;
}

function claudeUsage(u) {
  const input = Number(u?.input_tokens ?? 0);
  const cached = Number(u?.cache_read_input_tokens ?? 0) + Number(u?.cache_creation_input_tokens ?? 0);
  const output = Number(u?.output_tokens ?? 0);
  return { input_tokens: input, cached_tokens: cached, output_tokens: output, reasoning_tokens: 0, total_tokens: input + cached + output };
}

export function parseClaudeFiles(files) {
  const sessions = new Map();
  for (const file of files) {
    let currentTurn = null;
    for (const row of jsonLines(file)) {
      const sessionId = row.sessionId;
      if (!sessionId) continue;
      let s = sessions.get(sessionId);
      if (!s) {
        s = { provider: 'claude', session_id: sessionId, cwd: row.cwd ?? null, title: null, model: null,
          started_at: ts(row.timestamp), updated_at: ts(row.timestamp), totals: zero(), turns: new Map(), seen: new Set(), raw_ref: file };
        sessions.set(sessionId, s);
      }
      s.cwd ??= row.cwd ?? null;
      s.started_at = Math.min(s.started_at ?? Infinity, ts(row.timestamp) ?? Infinity);
      s.updated_at = Math.max(s.updated_at ?? 0, ts(row.timestamp) ?? 0);
      if (row.type === 'ai-title' && row.aiTitle) s.title = compactTitle(row.aiTitle);
      if (row.type === 'user' && !row.isMeta && !row.isSidechain) {
        const content = typeof row.message?.content === 'string' ? row.message.content : null;
        currentTurn = row.promptId ?? row.uuid ?? `turn-${row.timestamp}`;
        if (!s.turns.has(currentTurn)) s.turns.set(currentTurn, {
          turn_id: currentTurn, title: compactTitle(content, 'User turn'), model: null,
          started_at: ts(row.timestamp), updated_at: ts(row.timestamp), ...zero(),
        });
        if (!s.title && content) s.title = compactTitle(content);
      }
      if (row.type !== 'assistant' || !row.message?.usage) continue;
      const eventKey = row.message.id || row.requestId
        ? `${row.message.id ?? ''}:${row.requestId ?? ''}`
        : String(row.uuid ?? row.timestamp);
      if (s.seen.has(eventKey)) continue;
      s.seen.add(eventKey);
      const usage = claudeUsage(row.message.usage);
      const turnId = currentTurn ?? `background-${basename(file, '.jsonl')}`;
      if (!s.turns.has(turnId)) s.turns.set(turnId, {
        turn_id: turnId, title: row.isSidechain ? 'Subagent work' : 'Background work',
        model: row.message.model ?? null, started_at: ts(row.timestamp), updated_at: ts(row.timestamp), ...zero(),
      });
      const turn = s.turns.get(turnId);
      turn.model ??= row.message.model ?? null;
      turn.updated_at = Math.max(turn.updated_at ?? 0, ts(row.timestamp) ?? 0);
      add(turn, usage);
      add(s.totals, usage);
      s.model ??= row.message.model ?? null;
    }
  }
  return [...sessions.values()].map((s) => ({
    provider: s.provider, session_id: s.session_id, cwd: s.cwd, title: s.title ?? 'Claude session',
    model: s.model, started_at: Number.isFinite(s.started_at) ? s.started_at : null,
    updated_at: s.updated_at || null, raw_ref: s.raw_ref, ...s.totals, turns: [...s.turns.values()],
  }));
}

function codexCounts(u) {
  return {
    input_tokens: Number(u?.input_tokens ?? 0),
    cached_tokens: Number(u?.cached_input_tokens ?? 0),
    output_tokens: Number(u?.output_tokens ?? 0),
    reasoning_tokens: Number(u?.reasoning_output_tokens ?? 0),
    total_tokens: Number(u?.total_tokens ?? 0),
  };
}
const positiveDelta = (next, prev) => {
  const out = zero();
  for (const k of Object.keys(out)) out[k] = Math.max(0, Number(next[k] ?? 0) - Number(prev[k] ?? 0));
  return out;
};

export function parseCodexFile(file, threadNames = new Map()) {
  const rows = jsonLines(file);
  const meta = rows.find((r) => r.type === 'session_meta')?.payload ?? {};
  const sessionId = meta.id ?? basename(file, '.jsonl');
  const s = { provider: 'codex', session_id: sessionId, cwd: meta.cwd ?? null,
    title: threadNames.get(sessionId) ?? null, model: null, started_at: ts(meta.timestamp),
    updated_at: ts(meta.timestamp), raw_ref: file, ...zero(), turns: [], quota: [], plan_type: null };
  let turn = null;
  let previousTotal = zero();
  for (const row of rows) {
    s.updated_at = Math.max(s.updated_at ?? 0, ts(row.timestamp) ?? 0);
    if (row.type === 'turn_context') {
      s.cwd = row.payload?.cwd ?? s.cwd;
      s.model = row.payload?.model ?? s.model;
    }
    if (row.type === 'event_msg' && row.payload?.type === 'task_started') {
      if (turn) s.turns.push(turn);
      turn = { turn_id: row.payload.turn_id ?? `turn-${row.timestamp}`, title: compactTitle(row.payload.summary, 'Codex turn'),
        model: s.model, started_at: ts(row.timestamp), updated_at: ts(row.timestamp), ...zero() };
    }
    if (row.type === 'response_item' && row.payload?.type === 'message' && row.payload?.role === 'user') {
      const text = row.payload.content?.map?.((x) => x.text ?? x.input_text ?? '').join(' ') ?? '';
      if (!isInternalPrompt(text)) {
        if (turn && turn.title === 'Codex turn' && text) turn.title = compactTitle(text);
        if (!s.title && text) s.title = compactTitle(text);
      }
    }
    if (row.type !== 'event_msg' || row.payload?.type !== 'token_count') continue;
    const total = codexCounts(row.payload.info?.total_token_usage);
    const delta = positiveDelta(total, previousTotal);
    previousTotal = total;
    if (!turn) turn = { turn_id: `turn-${row.timestamp}`, title: 'Codex work', model: s.model,
      started_at: ts(row.timestamp), updated_at: ts(row.timestamp), ...zero() };
    turn.updated_at = ts(row.timestamp);
    turn.model ??= s.model;
    add(turn, delta);
    Object.assign(s, total);
    const limits = row.payload.rate_limits;
    if (limits) {
      s.quota = quotaFromCodex(limits, ts(row.timestamp));
      s.plan_type = limits.plan_type ?? s.plan_type;
    }
  }
  if (turn) s.turns.push(turn);
  s.title ??= compactTitle(threadNames.get(sessionId), 'Codex session');
  return s;
}

function quotaFromCodex(limits, capturedAt = Date.now()) {
  const rows = [];
  for (const name of ['primary', 'secondary']) {
    const w = limits?.[name];
    if (!w) continue;
    rows.push({ provider: 'codex', window_name: name, used_percent: w.used_percent ?? null,
      window_minutes: w.window_minutes ?? null, resets_at: epochMs(w.resets_at),
      credits: limits.credits ?? null, captured_at: capturedAt });
  }
  return rows;
}

function codexThreadNames() {
  const file = join(CODEX_ROOT, 'session_index.jsonl');
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const row of jsonLines(file)) if (row.id && row.thread_name) map.set(row.id, compactTitle(row.thread_name));
  return map;
}

function canonicalRoot(cwd) {
  if (!cwd) return null;
  const original = resolve(cwd);
  let dir = original;
  let foundGit = false;
  while (true) {
    if (existsSync(join(dir, '.git'))) { foundGit = true; break; }
    const parent = dirname(dir);
    if (parent === dir || dir === parsePath(dir).root) break;
    dir = parent;
  }
  return normalize(foundGit ? dir : original).replace(/[\\/]+$/, '').toLowerCase();
}

function ensureProject(mem, cwd, provider) {
  const root = canonicalRoot(cwd);
  if (!root) return null;
  const linked = mem.projectRoot(root);
  if (linked) return linked.project_id;
  const base = basename(root) || root;
  let name = base;
  let n = 2;
  while (mem.projectByName(name)) name = `${base} (${n++})`;
  mem.upsertProject({ name, summary: `Auto-created from ${provider} CLI usage at ${root}` });
  const project = mem.projectByName(name);
  mem.setProjectRoot({ root_path: root, project_id: project.id, provider });
  return project.id;
}

function changedFiles(mem, provider, files) {
  return files.filter((file) => {
    const st = statSync(file);
    const cur = mem.usageCursor(provider, file);
    return !cur || cur.file_size !== st.size || Math.round(cur.mtime_ms) !== Math.round(st.mtimeMs);
  });
}

function markFile(mem, provider, file) {
  const st = statSync(file);
  mem.setUsageCursor({ provider, file_path: file, byte_offset: st.size, file_size: st.size, mtime_ms: st.mtimeMs });
}

function saveSession(mem, session) {
  const projectId = ensureProject(mem, session.cwd, session.provider);
  mem.upsertUsageSession({ ...session, project_id: projectId });
  mem.replaceUsageTurns(session.provider, session.session_id, session.turns);
}

async function syncClaudeQuota(mem, fetchImpl) {
  const credFile = join(CLAUDE_ROOT, '.credentials.json');
  if (!existsSync(credFile)) {
    mem.upsertUsageAccount({ provider: 'claude', status: 'not_logged_in', error: 'Claude CLI credentials not found' });
    return;
  }
  try {
    const creds = JSON.parse(readFileSync(credFile, 'utf8'));
    const oauth = creds.claudeAiOauth ?? {};
    const accountRef = hashRef(creds.organizationUuid);
    const res = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
      headers: { authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`quota request failed (${res.status})`);
    const body = await res.json();
    const captured = Date.now();
    for (const [name, value] of Object.entries(body)) {
      if (!value || typeof value !== 'object' || value.utilization == null) continue;
      const utilization = Number(value.utilization);
      mem.addQuotaSnapshot({ provider: 'claude', window_name: name, used_percent: utilization <= 1 ? utilization * 100 : utilization,
        resets_at: ts(value.resets_at), captured_at: captured });
    }
    mem.upsertUsageAccount({ provider: 'claude', account_ref: accountRef, plan_type: oauth.subscriptionType ?? null, status: 'connected' });
  } catch (e) {
    mem.upsertUsageAccount({ provider: 'claude', status: 'local_only', error: e.message });
  }
}

function syncCodexAccount(mem, planType) {
  const authFile = join(CODEX_ROOT, 'auth.json');
  if (!existsSync(authFile)) {
    mem.upsertUsageAccount({ provider: 'codex', status: 'not_logged_in', error: 'Codex CLI credentials not found' });
    return;
  }
  try {
    const auth = JSON.parse(readFileSync(authFile, 'utf8'));
    mem.upsertUsageAccount({ provider: 'codex', account_ref: hashRef(auth.tokens?.account_id),
      plan_type: planType ?? null, status: 'connected' });
  } catch (e) {
    mem.upsertUsageAccount({ provider: 'codex', status: 'local_only', error: e.message });
  }
}

export async function syncUsage(mem, { fetchImpl = fetch } = {}) {
  const result = { claude: { files: 0, sessions: 0 }, codex: { files: 0, sessions: 0 }, errors: [] };
  const rebuildAttribution = mem.getMeta('usage_attribution_version') !== '3';
  const claudeFiles = filesUnder(join(CLAUDE_ROOT, 'projects'), (f) => f.endsWith('.jsonl'));
  const changedClaude = rebuildAttribution ? claudeFiles : changedFiles(mem, 'claude', claudeFiles);
  try {
    // Claude subagent files share the parent session. Rebuild all Claude sessions when
    // any file changes so a changed child cannot replace the parent's aggregate.
    const sessions = changedClaude.length ? parseClaudeFiles(claudeFiles) : [];
    for (const session of sessions) saveSession(mem, session);
    for (const file of changedClaude) markFile(mem, 'claude', file);
    result.claude = { files: changedClaude.length, sessions: sessions.length };
  } catch (e) { result.errors.push({ provider: 'claude', error: e.message }); }

  const codexFiles = filesUnder(join(CODEX_ROOT, 'sessions'), (f) => f.endsWith('.jsonl'));
  const changedCodex = rebuildAttribution ? codexFiles : changedFiles(mem, 'codex', codexFiles);
  let latestPlan = null;
  try {
    const names = codexThreadNames();
    for (const file of changedCodex) {
      const session = parseCodexFile(file, names);
      saveSession(mem, session);
      for (const q of session.quota) mem.addQuotaSnapshot(q);
      if (session.plan_type) latestPlan = session.plan_type;
      markFile(mem, 'codex', file);
    }
    result.codex = { files: changedCodex.length, sessions: changedCodex.length };
  } catch (e) { result.errors.push({ provider: 'codex', error: e.message }); }

  await syncClaudeQuota(mem, fetchImpl);
  syncCodexAccount(mem, latestPlan);
  mem.setMeta('usage_attribution_version', '3');
  return { ...result, summary: mem.usageSummary() };
}

export const usagePaths = { CLAUDE_ROOT, CODEX_ROOT };
