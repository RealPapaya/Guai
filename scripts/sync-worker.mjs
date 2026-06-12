import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { SidecarClient } from '../core/sidecar.js';

const cfg = loadConfig();
if (cfg.sidecar?.enabled === false) throw new Error('Worker sidecar is disabled in config.');
const client = new SidecarClient(cfg.sidecar);
const catalog = await client.catalog();
const mem = openMemory(paths.db);
try {
  const synced = mem.syncComponentCatalog(catalog);
  console.log(JSON.stringify({ synced, catalog }, null, 2));
} finally {
  mem.close();
}
