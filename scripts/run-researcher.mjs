import { openMemory } from '../core/memory.js';
import { loadConfig, paths } from '../core/config.js';
import { makeTaskEnvelope, SidecarClient } from '../core/sidecar.js';
import { ingestWorkerResult } from '../core/worker-results.js';

const objective = process.argv.slice(2).join(' ').trim();
if (!objective) {
  console.error('Usage: node scripts/run-researcher.mjs <research objective>');
  process.exit(2);
}

const cfg = loadConfig();
if (cfg.sidecar?.enabled === false) throw new Error('Worker sidecar is disabled in config.');
const task = makeTaskEnvelope({
  objective,
  taskType: 'research',
  difficulty: 'complex',
  riskLevel: 0,
  allowedCapabilities: ['network:search'],
  preferredWorker: 'researcher',
});
const client = new SidecarClient(cfg.sidecar);
const mem = openMemory(paths.db);

try {
  mem.createAgentTask(task);
  mem.updateAgentTask(task.taskId, { status: 'running' });
  const result = await client.dispatch(task);
  const ingest = ingestWorkerResult(mem, cfg, result, task);
  mem.updateAgentTask(task.taskId, { status: result.status, result, worker: task.preferredWorker });
  mem.addExecutionTrace({
    traceId: result.traceId || task.taskId,
    taskId: task.taskId,
    worker: task.preferredWorker,
    status: result.status,
    metrics: result.metrics,
    outcome: ingest,
  });
  console.log(JSON.stringify({ task, result, ingest }, null, 2));
} catch (error) {
  mem.updateAgentTask(task.taskId, { status: 'failed', error: error.message, worker: task.preferredWorker });
  throw error;
} finally {
  mem.close();
}
