// CLI entrypoint: render the morning brief from memory to stdout.
//   node scripts/run-brief.mjs            # print
//   node scripts/run-brief.mjs --save     # also write state/brief-latest.md
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { buildBriefModel, renderBrief } from '../core/render/brief.js';

const save = process.argv.includes('--save');
const cfg = loadConfig();
const mem = openMemory(paths.db);

const md = renderBrief(buildBriefModel(mem, cfg), cfg);
process.stdout.write(md + '\n');
if (save) {
  const out = join(paths.root, 'state', 'brief-latest.md');
  writeFileSync(out, md);
  console.error(`\n(saved to ${out})`);
}
mem.close();
