// Mark the morning brief as delivered (advances the digest cursor). Called by /guai-brief
// after the headline push is sent.
import { openMemory } from '../core/memory.js';
import { paths } from '../core/config.js';

const mem = openMemory(paths.db);
mem.markBriefSent();
console.log(`Brief marked sent at ${new Date(mem.lastBriefTs()).toISOString()}.`);
mem.close();
