// The decision gate — the heart of "minimize unnecessary interruptions".
// Pure function: maps a finding + run-context + config to ONE of five actions.
// The five branches operationalize Guai's decision framework:
//   Q1 worth attention?  Q4 EV > cost?  Q5 delegable?  Q3 deep analysis?  Q2 push now?
import {
  priority, ev, onActiveProject, isCrossDomain, isWorsening,
  alreadySurfaced, timeCritical,
} from './scoring.js';

/** @typedef {'ignore'|'store'|'digest'|'push'|'escalate'} GateAction */

function mk(action, extra) {
  return { action, ...extra };
}

/**
 * Decide what to do with a finding.
 * @returns {{action: GateAction, priority:number, ev:number, reason:string, to?:string}}
 */
export function decide(f, ctx, cfg, clock = Date.now()) {
  const g = cfg.gate ?? {};
  const sev = f.severity ?? 0;
  const onProj = onActiveProject(f, ctx);
  const p = priority(f, ctx, cfg, clock);
  const e = ev(f, cfg);
  const base = { priority: p, ev: e };

  // Q1 — Is this worth the user's attention at all? If not, drop it entirely.
  if (sev === 0 && !onProj) return mk('ignore', { ...base, reason: 'sev0 & not on active project' });

  // Q4 — Is expected value above the floor? If not, record but never surface.
  if (e <= (g.evFloor ?? 0)) return mk('store', { ...base, reason: 'EV at/below floor' });

  // Anti-nag — already surfaced, not worsening, not time-critical → rest in store.
  // It returns to push/escalate automatically the moment it worsens.
  if (alreadySurfaced(f, ctx) && !isWorsening(f, ctx) && !timeCritical(f, clock, cfg)) {
    return mk('store', { ...base, reason: 'already surfaced & stable' });
  }

  // Q5 — Can a specialized worker gather more signal before we decide? Delegate.
  if (f.needsMoreSignal && e > (g.researchEV ?? Infinity)) {
    return mk('escalate', { ...base, to: 'researcher', reason: 'needs more signal' });
  }

  // Q3 — Is deeper analysis justified? Cross-domain or top-severity → Opus chief.
  if (isCrossDomain(f, ctx) || sev >= (g.crossDomainSeverity ?? 4)) {
    return mk('escalate', { ...base, to: 'chief', reason: 'cross-domain or top severity' });
  }

  // Q2 — Is immediate communication necessary? High priority AND time-critical.
  // (Rate-limit / quiet-hours / daily-budget are enforced downstream by the push
  //  executor, which may defer a 'push' to the next digest — keeps this gate pure.)
  if (p >= (g.pushThreshold ?? 6) && timeCritical(f, clock, cfg)) {
    return mk('push', { ...base, reason: 'high priority & time-critical' });
  }

  // Default — routine: it goes in the next morning brief.
  return mk('digest', { ...base, reason: 'routine' });
}
