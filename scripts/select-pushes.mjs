// Decide which push-gated findings to actually send now (enforces quiet hours, caps,
// cooldown) and commit them to the comms log. Prints {send:[{id,text}], deferred:[...]}.
// The /guai-sweep skill reads .send and delivers each via the PushNotification tool.
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { selectPushes } from '../core/comms.js';

const cfg = loadConfig();
const mem = openMemory(paths.db);
const result = selectPushes(mem, cfg);
console.log(JSON.stringify(result, null, 2));
mem.close();
