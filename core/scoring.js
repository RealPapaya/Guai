// Pure scoring + feature extraction for the decision gate. No IO, no DB.
// Everything here is a deterministic function of (finding, run-context, config).
import { fingerprint } from './fingerprint.js';

const DAY = 864e5;

// ---- feature extractors -----------------------------------------------------

/** Does this finding belong to an active project (by id or repo/target match)? */
export function onActiveProject(f, ctx) {
  const projects = ctx?.projects ?? [];
  if (f.project_id && projects.some((p) => p.id === f.project_id)) return true;
  if (!f.target_ref) return false;
  return projects.some((p) => {
    const repos = p.repos_json ?? p.repos ?? [];
    return repos.some((r) => f.target_ref === r || f.target_ref.startsWith(r + '#') || f.target_ref.startsWith(r + ':'));
  });
}

/** 0..1 ramp: 1 if overdue, linearly down to 0 a week out, 0 if no deadline. */
export function deadlineProximityBoost(f, clock = Date.now()) {
  const dl = f.detail?.deadline ?? f.deadline;
  if (!dl) return 0;
  const days = (dl - clock) / DAY;
  if (days <= 0) return 1;
  if (days >= 7) return 0;
  return (7 - days) / 7;
}

function priorOpen(f, ctx) {
  const fp = fingerprint(f);
  return (ctx?.openFindings ?? []).find((o) => o.fingerprint === fp) ?? null;
}

/** Is the signal getting worse since we last saw it? */
export function isWorsening(f, ctx) {
  if (f.worsening) return true;
  const prior = priorOpen(f, ctx);
  return prior ? (f.severity ?? 0) > (prior.severity ?? 0) : false;
}

export function alreadySurfaced(f, ctx) {
  const prior = priorOpen(f, ctx);
  return prior ? prior.times_surfaced > 0 || prior.status === 'surfaced' : false;
}

export function timesAlreadySurfaced(f, ctx) {
  const prior = priorOpen(f, ctx);
  return prior ? prior.times_surfaced ?? 0 : 0;
}

/** Same project/target shows trouble from more than one source → cross-domain. */
export function isCrossDomain(f, ctx) {
  const open = ctx?.openFindings ?? [];
  const related = open.filter(
    (o) => (f.project_id && o.project_id === f.project_id) || (f.target_ref && o.target_ref === f.target_ref)
  );
  if (!related.length) return false;
  return new Set([f.source, ...related.map((o) => o.source)]).size > 1;
}

/** Needs to be acted on within the urgency window. */
export function timeCritical(f, clock = Date.now(), cfg = {}) {
  if (f.timeCritical) return true;
  const dl = f.detail?.deadline ?? f.deadline;
  const windowH = cfg.gate?.urgentWindowHours ?? 24;
  return dl ? dl - clock <= windowH * 3600e3 : false;
}

// ---- the two scores ---------------------------------------------------------

/** Composite priority — how much this earns the user's attention right now. */
export function priority(f, ctx, cfg, clock = Date.now()) {
  const w = cfg.gate?.weights ?? {};
  let p = f.severity ?? 0;
  if (onActiveProject(f, ctx)) p += w.project ?? 0;
  p += (w.deadline ?? 0) * deadlineProximityBoost(f, clock);
  if (isWorsening(f, ctx)) p += w.trend ?? 0;
  p -= (w.seenDecay ?? 0) * timesAlreadySurfaced(f, ctx);
  return Math.round(p * 100) / 100;
}

/** Expected value = impact of the situation minus the cost of acting/interrupting. */
export function ev(f, cfg) {
  const impact = cfg.impactWeights?.[f.kind] ?? cfg.impactWeights?.fyi ?? 0;
  const actionCost = f.actionCost ?? 0;
  return impact - actionCost;
}
