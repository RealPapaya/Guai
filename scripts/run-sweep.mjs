// CLI entrypoint for a monitoring sweep.
//   node scripts/run-sweep.mjs --dry            # use fixtures, no network
//   node scripts/run-sweep.mjs --repo=owner/name
//   node scripts/run-sweep.mjs --trigger=cron   # uses config.github.repos
import { openMemory } from '../core/memory.js';
import { loadConfig, githubToken, paths } from '../core/config.js';
import { runSweep } from '../core/sweep.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + '=')); return a ? a.split('=')[1] : null; };

const dry = has('--dry');
const repoArg = val('--repo');
const trigger = val('--trigger') ?? 'manual';

const cfg = loadConfig();
const mem = openMemory(paths.db);
const repos = repoArg ? [repoArg] : (cfg.github.repos ?? []);

if (!dry && repos.length === 0) {
  console.error('No repos configured. Add to config/guai.config.json → github.repos, pass --repo=owner/name, or use --dry.');
  process.exit(2);
}

const res = await runSweep(mem, cfg, { repos, dry, token: githubToken(), trigger });

const c = res.counts;
console.log(`\nSweep (${dry ? 'dry' : trigger}) — ${c.findings} findings across ${c.repos} repo(s)`);
console.log('  by action:', JSON.stringify(c.byAction));
if (res.errors.length) console.log('  errors:', res.errors.map((e) => `${e.repo}: ${e.error}`).join(' | '));

const hot = res.decided.filter((d) => d.gate_action === 'push' || d.gate_action === 'escalate');
if (hot.length) {
  console.log('\nHot items (push/escalate):');
  for (const f of hot) {
    console.log(`  [${f.gate_action.toUpperCase()}${f.gate.to ? '→' + f.gate.to : ''}] p=${f.priority} ev=${f.ev_score}  ${f.title}`);
  }
}
console.log('');
mem.close();
