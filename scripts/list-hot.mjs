// Emit the current hot findings (gate_action push/escalate, still open) as JSON.
// The Opus chief-of-staff reads this to reason over what actually needs the user.
import { openMemory } from '../core/memory.js';
import { paths } from '../core/config.js';

const mem = openMemory(paths.db);
const hot = mem.openFindings()
  .filter((f) => f.gate_action === 'push' || f.gate_action === 'escalate')
  .map((f) => ({
    id: f.id, source: f.source, kind: f.kind, title: f.title, target_ref: f.target_ref,
    severity: f.severity, priority: f.priority, gate_action: f.gate_action,
    times_surfaced: f.times_surfaced, detail: f.detail_json,
  }));
console.log(JSON.stringify(hot, null, 2));
mem.close();
