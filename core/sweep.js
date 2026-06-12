// The monitoring sweep, as a pure-Node function reusable by the CLI, by cron, and
// by agents that shell out to it. Pipeline: load context → ingest → resolve project
// → score → gate → persist. No LLM here; judgment-heavy enrichment is layered on by
// CC workers in M2. 'ignore' findings are dropped; everything else is persisted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priority, ev, onActiveProject } from './scoring.js';
import { decide } from './gate.js';
import { normalizeRepo, fetchRepoFindings } from './ingest/github.js';
import { runCostMonitor } from './cost.js';
import { maybeCondense } from './condenser.js';
import { paths, monitorEnabled } from './config.js';

function fixtureRepo(cfg, clock) {
  const fx = (n) => JSON.parse(readFileSync(join(paths.fixtures, n), 'utf8'));
  return normalizeRepo(
    { repo: 'me/repo', repoInfo: fx('github-repo.json'), pulls: fx('github-pulls.json'), runs: fx('github-runs.json').workflow_runs },
    cfg, clock
  );
}

function resolveProjectId(ref, projects) {
  if (!ref) return null;
  const p = projects.find((p) =>
    (p.repos_json ?? []).some((r) => ref === r || ref.startsWith(r + '#') || ref.startsWith(r + ':'))
  );
  return p?.id ?? null;
}

/**
 * Gate + persist a batch of raw findings (from ANY monitor or LLM worker) against a
 * loaded run-context. Shared by runSweep and by scripts/ingest-findings.mjs (the
 * bridge that lets MCP/LLM workers feed the same deterministic gate).
 */
export function gateAndPersist(mem, cfg, raw, ctx, clock = Date.now()) {
  const decided = raw.map((f) => {
    f.project_id = f.project_id ?? resolveProjectId(f.target_ref, ctx.projects);
    const g = decide(f, ctx, cfg, clock);
    return {
      ...f,
      priority: priority(f, ctx, cfg, clock),
      ev_score: ev(f, cfg),
      gate_action: g.action,
      onProject: onActiveProject(f, ctx),
      gate: g,
    };
  });
  const persisted = decided.filter((d) => d.gate_action !== 'ignore');
  mem.upsertFindings(persisted);
  const byAction = {};
  for (const d of decided) byAction[d.gate_action] = (byAction[d.gate_action] ?? 0) + 1;
  return { decided, persisted, byAction };
}

/**
 * Run one monitoring sweep.
 * @returns {{decided:Array, persisted:Array, stats:Array, errors:Array, counts:object}}
 */
export async function runSweep(mem, cfg, { repos = [], dry = false, token = null, trigger = 'manual', withCost = true, clock = Date.now() } = {}) {
  const ctx = mem.loadRunContext();
  const runId = mem.startRun({ trigger, since_ts: ctx.sinceTs });
  const errors = [];
  const stats = [];
  const raw = [];
  const skipped = [];

  // Per-domain arming. dev/cost are the deterministic monitors gated here; the
  // email/calendar toggles live in the same config block but are honored by the
  // CC-layer workflow (workflows/sweep.workflow.js), not this pure-Node sweep.
  const doDev = monitorEnabled(cfg, 'dev');
  const doCost = withCost && monitorEnabled(cfg, 'cost');

  try {
    // --- dev monitor (GitHub) ---
    if (!doDev) {
      skipped.push('dev');
    } else if (dry) {
      const r = fixtureRepo(cfg, clock);
      raw.push(...r.findings); stats.push(r.stats);
    } else {
      for (const repo of repos) {
        try {
          const r = await fetchRepoFindings(repo, cfg, { token, sinceTs: ctx.sinceTs }, clock);
          raw.push(...r.findings); stats.push(r.stats);
        } catch (e) {
          errors.push({ repo, error: e.message }); // one bad repo can't sink the sweep
        }
      }
    }

    // --- cost monitor (deterministic, no LLM) ---
    if (!doCost) {
      if (withCost) skipped.push('cost'); // disabled by config, not by the caller
    } else {
      try {
        const c = runCostMonitor(mem, cfg, { clock, dry });
        raw.push(...c.findings);
        stats.push({ repo: 'cost', costDays: c.series.length, latestUsd: c.latest?.usd ?? null, baselineUsd: c.baseline?.meanUsd ?? null });
      } catch (e) {
        errors.push({ repo: 'cost', error: e.message });
      }
    }

    const { decided, persisted, byAction } = gateAndPersist(mem, cfg, raw, ctx, clock);
    const condensed = maybeCondense(mem, cfg, clock); // keep the working set small
    const counts = { repos: stats.length, findings: decided.length, persisted: persisted.length, byAction, errors: errors.length, condensed, skipped };

    mem.endRun(runId, { counts, ok: errors.length === 0, error: errors.length ? JSON.stringify(errors) : null });
    return { decided, persisted, stats, errors, counts, skipped, ctx };
  } catch (fatal) {
    mem.endRun(runId, { ok: false, error: fatal.message });
    throw fatal;
  }
}
