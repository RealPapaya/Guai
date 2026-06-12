// Render the self-contained dashboard to state/dashboard.html from the current DB.
import { writeFileSync } from 'node:fs';
import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { renderDashboard } from '../core/render/dashboard.js';

const cfg = loadConfig();
const mem = openMemory(paths.db);
const html = renderDashboard(mem.snapshot(), cfg);
writeFileSync(paths.dashboard, html);
console.log(`Dashboard written to ${paths.dashboard} (${html.length} bytes). Open it in a browser.`);
mem.close();
