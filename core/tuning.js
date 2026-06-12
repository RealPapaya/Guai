// L5 learning: calibrate the gate's thresholds from how the principal actually responds.
// Pure analysis over the comms log — it proposes adjustments; applying them is explicit
// (calibrate.mjs --apply) so the system never silently drifts. Feedback (ack/snooze/act/
// dismiss) is recorded on comms_log via mem.recordResponse() — e.g. /guai-confirm can mark
// the triggering push 'act' on approve or 'dismiss' on reject; a future channel can feed more.

/**
 * @returns {{suggestions: Array<{kind:string, signal:string, change:string}>, byKind: object}}
 */
export function calibrate(mem, cfg) {
  const rows = mem.db.prepare(
    `SELECT c.fingerprint, c.user_response, f.kind
       FROM comms_log c LEFT JOIN findings f ON f.id = c.finding_id
      WHERE c.kind='push'`
  ).all();

  const byKind = {};
  for (const r of rows) {
    const k = r.kind ?? 'unknown';
    const b = (byKind[k] ??= { pushes: 0, dismiss: 0, snooze: 0, act: 0, ack: 0 });
    b.pushes++;
    if (r.user_response && b[r.user_response] != null) b[r.user_response]++;
  }

  const suggestions = [];
  for (const [kind, b] of Object.entries(byKind)) {
    if (b.pushes < 3) continue; // need a few data points
    const dismissRate = (b.dismiss + b.snooze) / b.pushes;
    const actRate = b.act / b.pushes;
    if (dismissRate >= 0.5) {
      suggestions.push({ kind, signal: `${Math.round(dismissRate * 100)}% dismissed/snoozed over ${b.pushes} pushes`, change: `raise pushThreshold for '${kind}' or lower its impact weight — it's interrupting too often` });
    } else if (actRate >= 0.7) {
      suggestions.push({ kind, signal: `${Math.round(actRate * 100)}% acted-on over ${b.pushes} pushes`, change: `'${kind}' is consistently valuable — safe to keep or slightly lower its threshold` });
    }
  }
  return { suggestions, byKind };
}
