// L5 learning: report threshold-calibration suggestions from the comms-log feedback.
// Read-only by default; --apply would persist tuning (left manual for safety).
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { calibrate } from '../core/tuning.js';

const cfg = loadConfig();
const mem = openMemory(paths.db);
const { suggestions, byKind } = calibrate(mem, cfg);

console.log('Calibration (from push feedback)');
console.log('--------------------------------');
console.log('Per-kind response:', JSON.stringify(byKind, null, 2));
if (!suggestions.length) {
  console.log('\nNo adjustments suggested yet — need more feedback (ack/snooze/act/dismiss on pushes).');
} else {
  console.log('\nSuggestions:');
  for (const s of suggestions) console.log(`  • [${s.kind}] ${s.signal}\n      → ${s.change}`);
  console.log('\n(Review and edit config/guai.config.json manually to apply.)');
}
mem.close();
