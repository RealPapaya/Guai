// Record the outcome of a propose-and-confirm action AFTER the skill has executed it.
//   node scripts/decide-action.mjs --id=3 --status=executed --result='{"messageId":"..."}'
//   node scripts/decide-action.mjs --id=3 --status=rejected
// status ∈ approved | rejected | executed | failed
import { openMemory } from '../core/memory.js';
import { paths } from '../core/config.js';

const val = (f) => { const a = process.argv.find((x) => x.startsWith(f + '=')); return a ? a.split('=').slice(1).join('=') : null; };
const id = Number(val('--id'));
const status = val('--status');
const resultRaw = val('--result');

if (!id || !status) { console.error('Usage: --id=N --status=executed|rejected|failed [--result=<json>]'); process.exit(2); }

let result = null;
if (resultRaw) { try { result = JSON.parse(resultRaw); } catch { result = { note: resultRaw }; } }

const mem = openMemory(paths.db);
mem.decideAction(id, status, result);
console.log(`Action ${id} → ${status}.`);
mem.close();
