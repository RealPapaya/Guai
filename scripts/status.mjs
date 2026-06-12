// Quick textual status of Guai's current state (the deterministic part of /guai-status).
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';

const cfg = loadConfig();
const mem = openMemory(paths.db);

const open = mem.openFindings();
const byAction = {};
for (const f of open) byAction[f.gate_action] = (byAction[f.gate_action] ?? 0) + 1;
const cost = mem.costSummary();
const lastRun = mem.lastRunEndedAt();

console.log('Guai status');
console.log('-----------');
console.log(`Active projects : ${mem.activeProjects().map((p) => p.name).join(', ') || '(none)'}`);
console.log(`Watch targets   : ${mem.watchTargets().length}`);
console.log(`Open findings   : ${open.length}  ${JSON.stringify(byAction)}`);
console.log(`Pending actions : ${mem.pendingActions().length}  (awaiting /guai-confirm)`);
console.log(`Investigations  : ${mem.openInvestigations().length} open`);
console.log(`Cost (latest)   : ${cost.latest ? `~$${cost.latest.usd} vs $${cost.baselineUsd ?? '—'} baseline (estimated)` : 'not tracked yet'}`);
console.log(`Last run        : ${lastRun ? new Date(lastRun).toLocaleString('en-US') : 'never'}`);
console.log(`Last brief      : ${mem.lastBriefTs() ? new Date(mem.lastBriefTs()).toLocaleString('en-US') : 'never'}`);
mem.close();
