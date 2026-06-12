// Export the whole DB to a human-readable JSON snapshot (portable / inspectable / diffable).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemory } from '../core/memory.js';
import { paths } from '../core/config.js';

const mem = openMemory(paths.db);
const snap = mem.snapshot();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(paths.snapshots, `snapshot-${stamp}.json`);
writeFileSync(out, JSON.stringify(snap, null, 2));
console.log(`Exported snapshot to ${out}`);
mem.close();
