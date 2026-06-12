// Emit Guai's recommended cron schedule. This script does NOT create the crons itself
// (CronCreate is a Claude Code tool, not a Node API) — the /guai-setup skill reads this
// JSON and calls CronCreate for each. Times are LOCAL. Off-:00 minutes avoid fleet pile-up.
//
// Durability note: in-session CC cron auto-expires after ~7 days and only fires while the
// REPL is idle. For true 24/7 autonomy, mirror these to Windows Task Scheduler running
// `claude -p "<prompt>"` headless (printed at the end).
import { loadConfig } from '../core/config.js';

const cfg = loadConfig();
const b = cfg.brief ?? {};

const schedule = [
  { name: 'guai-light-sweep', cron: '7 9-18 * * 1-5', prompt: '/guai-sweep --light', durable: true, recurring: true, note: 'hourly business-hours: dev + cost only' },
  { name: 'guai-full-sweep', cron: '23 */3 * * *', prompt: '/guai-sweep', durable: true, recurring: true, note: 'every ~3h: all monitors' },
  { name: 'guai-morning-brief', cron: `${b.minute ?? 57} ${b.hour ?? 7} * * 1-5`, prompt: '/guai-brief', durable: true, recurring: true, note: 'weekday morning brief + one headline push' },
  { name: 'guai-weekly-review', cron: '33 17 * * 5', prompt: '/guai-review', durable: true, recurring: true, note: 'Friday: trends, condense, threshold calibration' },
];

console.log(JSON.stringify({ schedule }, null, 2));
console.error('\n# Windows Task Scheduler equivalent (durable, fires even when no REPL is open):');
for (const s of schedule) {
  console.error(`#   schtasks /Create /TN "${s.name}" /SC ... /TR "claude -p \\"${s.prompt}\\""   # ${s.cron}`);
}
