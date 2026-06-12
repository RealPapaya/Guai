// The bridge: take raw findings JSON produced by an LLM/MCP worker (inbox-triage,
// calendar-aide, researcher, …) and run them through the SAME deterministic gate +
// persistence as the built-in monitors. Any finding carrying detail.proposedAction is
// enqueued to the action_queue as 'pending' (propose-and-confirm) — never executed here.
//
//   echo '{"findings":[...]}' | node scripts/ingest-findings.mjs
//   node scripts/ingest-findings.mjs --file=batch.json
import { readFileSync } from 'node:fs';
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { gateAndPersist } from '../core/sweep.js';
import { mergeAndDedupe } from '../workflows/lib/collect.js';
import { validateFindings } from '../workflows/lib/schemas.js';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const raw = fileArg ? readFileSync(fileArg.split('=')[1], 'utf8') : await readStdin();
if (!raw.trim()) { console.error('No input. Pipe findings JSON or pass --file=.'); process.exit(2); }

const parsed = JSON.parse(raw);
const incoming = Array.isArray(parsed) ? parsed : parsed.findings ?? [];
const { valid, invalid } = validateFindings(incoming);

const cfg = loadConfig();
const mem = openMemory(paths.db);
const runId = mem.startRun({ trigger: 'worker' });
const ctx = mem.loadRunContext();

const merged = mergeAndDedupe([valid]);
const res = gateAndPersist(mem, cfg, merged, ctx);

// Propose-and-confirm: queue any drafted outward actions (pending, never sent here).
let queued = 0;
for (const d of res.decided) {
  const pa = d.detail?.proposedAction;
  if (pa?.kind && pa.payload) {
    mem.enqueueAction({ kind: pa.kind, payload: pa.payload, rationale: pa.rationale ?? d.title });
    queued++;
  }
}

mem.endRun(runId, { counts: { findings: res.decided.length, persisted: res.persisted.length, byAction: res.byAction, queued, invalid: invalid.length } });
console.log(JSON.stringify({
  persisted: res.persisted.length, byAction: res.byAction, queuedActions: queued,
  invalid: invalid.length, invalidDetail: invalid.slice(0, 5),
}, null, 2));
mem.close();
