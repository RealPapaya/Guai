// Print pending propose-and-confirm actions (auto-expires stale ones). The /guai-confirm
// skill reads this, presents each to the user, and executes only on approval.
import { openMemory } from '../core/memory.js';
import { paths } from '../core/config.js';

const mem = openMemory(paths.db);
console.log(JSON.stringify(mem.pendingActions(), null, 2));
mem.close();
