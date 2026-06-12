export const meta = {
  name: 'guai-sweep',
  description: 'Guai monitoring sweep: fan out tiered monitors in parallel, gate + persist through the portable core, then let the Opus chief reason over the hot set.',
  phases: [
    { title: 'Monitor', detail: 'dev+cost (deterministic) and inbox+calendar (MCP) in parallel' },
    { title: 'Decide', detail: 'persist worker findings via the gate, Opus chief over the hot set' },
  ],
};

// NOTE: the Workflow sandbox has no filesystem/Node access, so every data step is an
// AGENT that shells out to a node script in scripts/. Pure JS here only merges results.
// The finding schema is inlined because the sandbox cannot import workflows/lib/schemas.js.
const FINDINGS = {
  type: 'object', required: ['findings'], additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['source', 'kind', 'title'], additionalProperties: true,
        properties: {
          source: { type: 'string' }, kind: { type: 'string' }, target_ref: { type: 'string' },
          key: { type: 'string' }, title: { type: 'string' },
          severity: { type: 'integer' }, timeCritical: { type: 'boolean' },
          detail: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
};

phase('Monitor');
// dev+cost are deterministic and self-persisting (run-sweep gates + writes them).
// inbox+calendar require MCP + judgment, so they EMIT findings to be persisted in Decide.
const [sweep, inbox, cal] = await parallel([
  () => agent(
    'Run Guai\'s deterministic monitors: execute `node scripts/run-sweep.mjs --trigger=cron` '
    + 'from the repo root (D:/Google AI/guai). It ingests GitHub + cost, gates, and persists. '
    + 'Return its stdout summary verbatim.',
    { label: 'dev+cost', phase: 'Monitor' }
  ),
  () => agent(
    'You are inbox-triage. Triage recent Gmail via the Gmail MCP tools and return findings '
    + '(needs_reply/important) with drafted replies as detail.proposedAction. If Gmail is not '
    + 'authenticated, return {"findings":[]}. Do NOT send anything.',
    { label: 'inbox-triage', agentType: 'inbox-triage', phase: 'Monitor', schema: FINDINGS }
  ),
  () => agent(
    'You are calendar-aide. Scan the next 2 days via the Calendar MCP tools and return findings '
    + '(calendar_conflict/meeting_prep). If Calendar is not authenticated, return {"findings":[]}.',
    { label: 'calendar-aide', agentType: 'calendar-aide', phase: 'Monitor', schema: FINDINGS }
  ),
]);

const workerFindings = [inbox, cal].filter(Boolean).flatMap((r) => r?.findings ?? []);
log(`deterministic sweep done; ${workerFindings.length} MCP-worker findings to persist`);

phase('Decide');
let bridge = { skipped: true };
if (workerFindings.length) {
  bridge = await agent(
    'Persist these worker findings through Guai\'s gate. From the repo root (D:/Google AI/guai), '
    + 'write the following JSON to a temp file and run '
    + '`node scripts/ingest-findings.mjs --file=<tmpfile>`. The JSON is:\n'
    + JSON.stringify({ findings: workerFindings })
    + '\nReturn the script\'s JSON output verbatim.',
    { label: 'gate+persist', phase: 'Decide', schema: { type: 'object', additionalProperties: true } }
  );
}

const directives = await agent(
  'You are Guai\'s chief of staff. Run `node scripts/list-hot.mjs` to read the current '
  + 'push/escalate findings. Re-prioritize across domains, collapse same-root-cause items, and '
  + 'for each decide push-now vs hold-for-digest. Compose any push as ONE line <=200 chars, '
  + 'action-first, quantified. Propose outward actions only as drafts. Do NOT send/comment/commit. '
  + 'Return {pushes:[{text,findingId}], notes}.',
  {
    label: 'chief-of-staff', agentType: 'chief-of-staff', model: 'opus', phase: 'Decide',
    schema: { type: 'object', additionalProperties: true, properties: { pushes: { type: 'array' }, notes: { type: 'string' } } },
  }
);

return { sweep, workerFindings: workerFindings.length, bridge, directives };
