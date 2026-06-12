// The ONLY module that touches the database. Everything Guai remembers — projects,
// findings, investigations, decisions, cost, the action queue, comms, run history —
// is read and written through here. Pure Node, zero Claude Code dependency.

import { openDb } from './db.js';
import { fingerprint } from './fingerprint.js';

const now = () => Date.now();

export { fingerprint };

function parse(row, ...jsonCols) {
  if (!row) return row;
  for (const c of jsonCols) {
    if (row[c] != null) {
      try { row[c] = JSON.parse(row[c]); } catch { /* leave as-is */ }
    }
  }
  return row;
}

/**
 * Open the Guai memory layer.
 * @param {string} dbPath
 * @returns memory API
 */
export function openMemory(dbPath) {
  const db = openDb(dbPath);
  const cache = new Map();
  const q = (sql) => cache.get(sql) ?? (cache.set(sql, db.prepare(sql)), cache.get(sql));
  const J = (v) => (v == null ? null : JSON.stringify(v));

  const api = {
    db,
    close: () => db.close(),

    // ---- meta ------------------------------------------------------------
    getMeta(key, fallback = null) {
      const r = q('SELECT value FROM meta WHERE key = ?').get(key);
      return r ? r.value : fallback;
    },
    setMeta(key, value) {
      q(`INSERT INTO meta(key,value) VALUES(?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
    },

    // ---- watch targets ---------------------------------------------------
    addWatchTarget({ kind, ref, config = null, active = 1 }) {
      return q(`INSERT INTO watch_targets(kind,ref,config_json,active,created_at)
                VALUES(?,?,?,?,?)
                ON CONFLICT(kind,ref) DO UPDATE SET
                  config_json = excluded.config_json, active = excluded.active`)
        .run(kind, ref, J(config), active ? 1 : 0, now()).lastInsertRowid;
    },
    watchTargets(kind) {
      const rows = kind
        ? q('SELECT * FROM watch_targets WHERE active=1 AND kind=?').all(kind)
        : q('SELECT * FROM watch_targets WHERE active=1').all();
      return rows.map((r) => parse(r, 'config_json'));
    },

    // ---- projects --------------------------------------------------------
    upsertProject({ name, status = 'active', repos = null, owner = null, summary = null }) {
      return q(`INSERT INTO projects(name,status,repos_json,owner,summary,last_activity_at,created_at)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(name) DO UPDATE SET
                  status=excluded.status, repos_json=excluded.repos_json,
                  owner=excluded.owner, summary=excluded.summary`)
        .run(name, status, J(repos), owner, summary, now(), now()).lastInsertRowid;
    },
    activeProjects() {
      return q(`SELECT * FROM projects WHERE status='active' ORDER BY last_activity_at DESC`)
        .all().map((r) => parse(r, 'repos_json'));
    },
    touchProject(id, ts = now()) {
      q('UPDATE projects SET last_activity_at=? WHERE id=?').run(ts, id);
    },

    // ---- findings (with fingerprint dedupe) ------------------------------
    /**
     * Insert a finding, or refresh an existing open one with the same fingerprint
     * (bumps last_seen + re-scores instead of duplicating). Returns {id, isNew}.
     */
    upsertFinding(f) {
      const fp = fingerprint(f);
      const t = now();
      const existing = q(
        `SELECT id, times_surfaced FROM findings
         WHERE fingerprint=? AND status NOT IN ('resolved','ignored')
         ORDER BY id DESC LIMIT 1`
      ).get(fp);

      if (existing) {
        q(`UPDATE findings SET
             title=?, detail_json=?, severity=?, priority=?, ev_score=?,
             gate_action=?, project_id=?, last_seen_at=?
           WHERE id=?`).run(
          f.title, J(f.detail ?? f.detail_json ?? null),
          f.severity ?? 0, f.priority ?? 0, f.ev_score ?? 0,
          f.gate_action ?? null, f.project_id ?? null, t, existing.id
        );
        return { id: existing.id, isNew: false };
      }

      const id = q(`INSERT INTO findings
          (source,kind,target_ref,project_id,title,detail_json,severity,priority,
           ev_score,gate_action,status,fingerprint,times_surfaced,first_seen_at,last_seen_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(
        f.source, f.kind, f.target_ref ?? null, f.project_id ?? null, f.title,
        J(f.detail ?? f.detail_json ?? null), f.severity ?? 0, f.priority ?? 0,
        f.ev_score ?? 0, f.gate_action ?? null, f.status ?? 'open', fp, t, t
      ).lastInsertRowid;
      return { id, isNew: true };
    },
    upsertFindings(list) {
      return list.map((f) => ({ ...api.upsertFinding(f), fingerprint: fingerprint(f) }));
    },
    getFinding(id) {
      return parse(q('SELECT * FROM findings WHERE id=?').get(id), 'detail_json');
    },
    openFindings() {
      return q(`SELECT * FROM findings WHERE status IN ('open','surfaced','snoozed')
                ORDER BY priority DESC, last_seen_at DESC`)
        .all().map((r) => parse(r, 'detail_json'));
    },
    /** Items eligible for the next digest: surfaced or routed to digest/push/escalate. */
    findingsForDigest(sinceTs = 0) {
      return q(`SELECT * FROM findings
                WHERE last_seen_at >= ?
                  AND status NOT IN ('resolved','ignored')
                  AND gate_action IN ('digest','push','escalate')
                ORDER BY priority DESC`)
        .all(sinceTs).map((r) => parse(r, 'detail_json'));
    },
    markSurfaced(id, ts = now()) {
      q(`UPDATE findings SET status='surfaced', surfaced_at=?,
           times_surfaced=times_surfaced+1 WHERE id=?`).run(ts, id);
    },
    resolveFinding(id, ts = now()) {
      q(`UPDATE findings SET status='resolved', resolved_at=? WHERE id=?`).run(ts, id);
    },
    setFindingStatus(id, status) {
      q('UPDATE findings SET status=? WHERE id=?').run(status, id);
    },
    timesSurfacedFor(fp) {
      const r = q(`SELECT COALESCE(MAX(times_surfaced),0) n FROM findings WHERE fingerprint=?`).get(fp);
      return r ? r.n : 0;
    },

    // ---- investigations --------------------------------------------------
    upsertInvestigation(inv) {
      if (inv.id) {
        q(`UPDATE investigations SET status=?, findings_json=?, summary=?, next_step=?,
             model_used=?, updated_at=? WHERE id=?`).run(
          inv.status ?? 'open', J(inv.findings ?? null), inv.summary ?? null,
          inv.next_step ?? null, inv.model_used ?? null, now(), inv.id);
        return inv.id;
      }
      return q(`INSERT INTO investigations
          (question,status,findings_json,summary,next_step,model_used,opened_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(
        inv.question, inv.status ?? 'open', J(inv.findings ?? null), inv.summary ?? null,
        inv.next_step ?? null, inv.model_used ?? null, now(), now()).lastInsertRowid;
    },
    openInvestigations() {
      return q(`SELECT * FROM investigations WHERE status='open' ORDER BY updated_at DESC`)
        .all().map((r) => parse(r, 'findings_json'));
    },

    // ---- decisions -------------------------------------------------------
    addDecision({ topic, decision, rationale = null, related_finding_id = null, decided_by = 'guai' }) {
      return q(`INSERT INTO decisions(topic,decision,rationale,related_finding_id,decided_by,decided_at)
                VALUES(?,?,?,?,?,?)`)
        .run(topic, decision, rationale, related_finding_id, decided_by, now()).lastInsertRowid;
    },
    recentDecisions(limit = 20) {
      return q('SELECT * FROM decisions ORDER BY decided_at DESC LIMIT ?').all(limit);
    },

    // ---- cost ------------------------------------------------------------
    insertUsage({ period_start, period_end, source, tokens = null, usd = 0, raw_ref = null }) {
      return q(`INSERT INTO cost_usage(period_start,period_end,source,tokens_json,usd,raw_ref,ingested_at)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(source,period_start,period_end) DO UPDATE SET
                  tokens_json=excluded.tokens_json, usd=excluded.usd,
                  raw_ref=excluded.raw_ref, ingested_at=excluded.ingested_at`)
        .run(period_start, period_end, source, J(tokens), usd, raw_ref, now()).lastInsertRowid;
    },
    usageSince(sinceTs) {
      return q('SELECT * FROM cost_usage WHERE period_start >= ? ORDER BY period_start')
        .all(sinceTs).map((r) => parse(r, 'tokens_json'));
    },
    setBaseline({ metric, window_days, baseline_value, stddev = 0 }) {
      q(`INSERT INTO cost_baselines(metric,window_days,baseline_value,stddev,computed_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(metric,window_days) DO UPDATE SET
           baseline_value=excluded.baseline_value, stddev=excluded.stddev,
           computed_at=excluded.computed_at`)
        .run(metric, window_days, baseline_value, stddev, now());
    },
    baselines() {
      return q('SELECT * FROM cost_baselines').all();
    },
    /** Latest day's usage + the daily_usd baseline — for the brief/dashboard cost line. */
    costSummary() {
      const latest = parse(q('SELECT * FROM cost_usage ORDER BY period_start DESC LIMIT 1').get(), 'tokens_json');
      const base = q(`SELECT * FROM cost_baselines WHERE metric='daily_usd' ORDER BY window_days DESC LIMIT 1`).get();
      return { latest: latest ?? null, baselineUsd: base ? base.baseline_value : null };
    },

    // ---- action queue (propose-and-confirm) ------------------------------
    enqueueAction({ kind, payload, rationale = null, related_finding_id = null, ttlMs = 7 * 864e5 }) {
      const t = now();
      return q(`INSERT INTO action_queue
          (kind,payload_json,rationale,related_finding_id,status,proposed_at,expires_at)
          VALUES(?,?,?,?, 'pending', ?, ?)`)
        .run(kind, J(payload), rationale, related_finding_id, t, t + ttlMs).lastInsertRowid;
    },
    enqueueActions(list = []) {
      return list.map((a) => api.enqueueAction(a));
    },
    pendingActions() {
      const t = now();
      // Lazily expire stale ones first.
      q(`UPDATE action_queue SET status='expired', decided_at=?
         WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < ?`).run(t, t);
      return q(`SELECT * FROM action_queue WHERE status='pending' ORDER BY proposed_at`)
        .all().map((r) => parse(r, 'payload_json'));
    },
    decideAction(id, status, result = null) {
      q(`UPDATE action_queue SET status=?, result_json=?, decided_at=? WHERE id=?`)
        .run(status, J(result), now(), id);
    },

    // ---- comms log (rate-limiting + learning feedback) -------------------
    logComms({ kind, finding_id = null, fingerprint = null, text = null, at = null }) {
      return q(`INSERT INTO comms_log(kind,finding_id,fingerprint,text,sent_at)
                VALUES(?,?,?,?,?)`).run(kind, finding_id, fingerprint, text, at ?? now()).lastInsertRowid;
    },
    recordResponse(id, response) {
      q('UPDATE comms_log SET user_response=?, responded_at=? WHERE id=?').run(response, now(), id);
    },
    pushesSince(sinceTs) {
      const r = q(`SELECT COUNT(*) n FROM comms_log WHERE kind='push' AND sent_at >= ?`).get(sinceTs);
      return r ? r.n : 0;
    },
    lastPushForFingerprint(fp) {
      const r = q(`SELECT MAX(sent_at) t FROM comms_log WHERE kind='push' AND fingerprint=?`).get(fp);
      return r && r.t ? r.t : 0;
    },

    // ---- run log (delta cursor + partial-failure record) -----------------
    startRun({ trigger, since_ts = null }) {
      return q(`INSERT INTO run_log(trigger,started_at,since_ts,ok) VALUES(?,?,?,1)`)
        .run(trigger, now(), since_ts).lastInsertRowid;
    },
    endRun(id, { counts = null, ok = true, error = null } = {}) {
      q(`UPDATE run_log SET ended_at=?, counts_json=?, ok=?, error=? WHERE id=?`)
        .run(now(), J(counts), ok ? 1 : 0, error, id);
    },
    lastRunEndedAt() {
      const r = q(`SELECT MAX(ended_at) t FROM run_log WHERE ok=1 AND ended_at IS NOT NULL`).get();
      return r && r.t ? r.t : 0;
    },
    lastBriefTs() {
      return Number(api.getMeta('last_brief_ts', 0));
    },
    markBriefSent(ts = now()) {
      api.setMeta('last_brief_ts', ts);
    },

    // ---- history digest (condenser) --------------------------------------
    latestHistoryDigest() {
      return q('SELECT * FROM history_digest ORDER BY created_at DESC LIMIT 1').get() ?? null;
    },
    addHistoryDigest({ window_start, window_end, summary }) {
      return q(`INSERT INTO history_digest(window_start,window_end,summary,created_at)
                VALUES(?,?,?,?)`).run(window_start, window_end, summary, now()).lastInsertRowid;
    },

    // ---- the stateful-across-ticks read ----------------------------------
    /** Everything a monitoring run needs at startup. */
    loadRunContext(sinceTs = null) {
      const since = sinceTs ?? api.lastRunEndedAt();
      return {
        sinceTs: since,
        now: now(),
        projects: api.activeProjects(),
        watchTargets: api.watchTargets(),
        openFindings: api.openFindings(),
        baselines: api.baselines(),
        pendingActions: api.pendingActions(),
        openInvestigations: api.openInvestigations(),
        historyDigest: api.latestHistoryDigest(),
      };
    },

    /** A portable, JSON-serializable snapshot of the whole DB (for export/dashboard). */
    snapshot() {
      const all = (t) => db.prepare(`SELECT * FROM ${t}`).all();
      return {
        generated_at: now(),
        projects: all('projects'),
        findings: all('findings'),
        investigations: all('investigations'),
        decisions: all('decisions'),
        cost_usage: all('cost_usage'),
        cost_baselines: all('cost_baselines'),
        action_queue: all('action_queue'),
        comms_log: all('comms_log'),
        run_log: all('run_log'),
        watch_targets: all('watch_targets'),
      };
    },
  };

  return api;
}
