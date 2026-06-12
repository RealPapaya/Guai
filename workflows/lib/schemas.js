// Canonical finding contract shared by every worker. Monitor agents (dev-watcher,
// cost-monitor, inbox-triage, calendar-aide, researcher) emit findings in THIS shape
// so the deterministic gate can consume them uniformly. The JSON Schemas are for
// Workflow `agent({schema})` structured output; validateFindings() is the dependency-
// free check the bridge (scripts/ingest-findings.mjs) runs before persisting.

/** One finding, as a worker emits it. */
export const FINDING_SCHEMA = {
  type: 'object',
  required: ['source', 'kind', 'title'],
  additionalProperties: true,
  properties: {
    source: { type: 'string', enum: ['dev', 'cost', 'inbox', 'calendar', 'research'] },
    kind: { type: 'string', description: 'e.g. ci_failure, stale_pr, review_backlog, needs_reply, calendar_conflict, cost_anomaly, opportunity' },
    target_ref: { type: 'string', description: 'repo / thread id / event id' },
    key: { type: 'string', description: 'STABLE dedupe key for a recurring signal (title may vary)' },
    title: { type: 'string' },
    severity: { type: 'integer', minimum: 0, maximum: 4 },
    timeCritical: { type: 'boolean' },
    worsening: { type: 'boolean' },
    needsMoreSignal: { type: 'boolean' },
    deadline: { type: 'number', description: 'epoch ms, if any' },
    detail: {
      type: 'object', additionalProperties: true,
      description: 'links, numbers, drafts; may include proposedAction {kind,payload,rationale}',
    },
  },
};

/** What a monitor agent returns: a list of findings. */
export const FINDINGS_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['findings'],
  additionalProperties: false,
  properties: { findings: { type: 'array', items: FINDING_SCHEMA } },
};

const SOURCES = new Set(['dev', 'cost', 'inbox', 'calendar', 'research']);

export function validateFinding(f) {
  const errors = [];
  if (!f || typeof f !== 'object') return { ok: false, errors: ['not an object'] };
  if (typeof f.source !== 'string' || !SOURCES.has(f.source)) errors.push(`bad source: ${f.source}`);
  if (typeof f.kind !== 'string' || !f.kind) errors.push('missing kind');
  if (typeof f.title !== 'string' || !f.title) errors.push('missing title');
  if (f.severity != null && (!Number.isInteger(f.severity) || f.severity < 0 || f.severity > 4)) {
    errors.push(`severity out of range: ${f.severity}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Returns { valid, invalid } partitions. */
export function validateFindings(list) {
  const valid = [], invalid = [];
  for (const f of list ?? []) {
    const v = validateFinding(f);
    (v.ok ? valid : invalid).push(v.ok ? f : { finding: f, errors: v.errors });
  }
  return { valid, invalid };
}
