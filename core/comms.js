// Push delivery policy — the downstream guard that keeps "push the exception".
// The gate decides a finding is push-worthy; THIS decides whether to actually
// interrupt the principal right now, enforcing quiet hours, hourly/daily caps, and a
// per-fingerprint cooldown. Anything blocked stays available for the next digest.
const HOUR = 3600e3;

export function inQuietHours(clock, cfg) {
  const h = new Date(clock).getHours();
  const { start = 21, end = 7 } = cfg.quietHours ?? {};
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Can we push THIS finding right now? Returns {ok, reason}. */
export function canPushNow(mem, finding, cfg, clock = Date.now()) {
  const p = cfg.push ?? {};
  if (inQuietHours(clock, cfg)) return { ok: false, reason: 'quiet hours' };
  if (mem.pushesSince(clock - HOUR) >= (p.maxPerHour ?? 3)) return { ok: false, reason: 'hourly cap' };
  if (mem.pushesSince(clock - 24 * HOUR) >= (p.maxPerDay ?? 12)) return { ok: false, reason: 'daily cap' };
  const last = mem.lastPushForFingerprint(finding.fingerprint);
  if (last && clock - last < (p.cooldownMinutesPerFingerprint ?? 180) * 60e3) return { ok: false, reason: 'fingerprint cooldown' };
  return { ok: true };
}

/** One-line, action-first, length-capped push text. */
export function pushText(finding, cfg) {
  const max = cfg.push?.maxChars ?? 200;
  const body = finding.detail_json?.pushText ?? finding.title;
  const t = `Guai: ${body}`;
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * Select which push-gated findings to actually send now. Commits each selected push to
 * the comms log + marks the finding surfaced AS IT GOES, so the per-run total still
 * respects the hourly/daily caps and nothing double-sends. The caller delivers .send via
 * the PushNotification tool. Blocked items are returned in .deferred (they remain in the
 * digest set).
 */
export function selectPushes(mem, cfg, clock = Date.now()) {
  const hot = mem.openFindings().filter((f) => f.gate_action === 'push');
  const send = [], deferred = [];
  for (const f of hot) {
    const can = canPushNow(mem, f, cfg, clock);
    if (!can.ok) { deferred.push({ id: f.id, title: f.title, reason: can.reason }); continue; }
    const text = pushText(f, cfg);
    mem.logComms({ kind: 'push', finding_id: f.id, fingerprint: f.fingerprint, text, at: clock });
    mem.markSurfaced(f.id, clock);
    send.push({ id: f.id, fingerprint: f.fingerprint, text });
  }
  return { send, deferred };
}
