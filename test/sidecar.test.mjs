import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory } from '../core/memory.js';
import { loadConfig } from '../core/config.js';
import { makeTaskEnvelope, SidecarClient } from '../core/sidecar.js';
import { validateResultEnvelope, validateTaskEnvelope } from '../core/bridge-contract.js';
import { ingestWorkerResult } from '../core/worker-results.js';
import { actionRiskLevel, riskPolicy } from '../core/risk.js';

test('task envelope has strict routing, budget, and risk fields', () => {
  const task = makeTaskEnvelope({ objective: 'Research release risk', preferredWorker: 'researcher' });
  assert.equal(validateTaskEnvelope(task).ok, true);
  assert.equal(task.taskType, 'research');
  assert.equal(task.riskLevel, 0);
  assert.ok(task.taskId);
  assert.equal(validateTaskEnvelope({ ...task, riskLevel: 9 }).ok, false);
});

test('sidecar client rejects a mismatched result task id', async () => {
  const task = makeTaskEnvelope({ objective: 'x' });
  const client = new SidecarClient({
    fetchImpl: async () => new Response(JSON.stringify({
      taskId: 'wrong', status: 'completed', findings: [], proposedActions: [], artifacts: [], metrics: {},
    }), { status: 200 }),
  });
  await assert.rejects(() => client.dispatch(task), /taskId mismatch/);
});

test('worker result goes through gate and queues proposals without executing', () => {
  const mem = openMemory(':memory:');
  const cfg = loadConfig();
  const task = makeTaskEnvelope({ objective: 'Find risk', riskLevel: 0 });
  const result = {
    taskId: task.taskId,
    status: 'completed',
    summary: 'Found one risk',
    findings: [{ source: 'research', kind: 'opportunity', title: 'Investigate release', severity: 2 }],
    proposedActions: [{ kind: 'send_email', payload: { to: 'x@y.z', body: 'draft' }, riskLevel: 2 }],
    artifacts: [],
    traceId: 'trace-1',
    metrics: {},
  };
  assert.equal(validateResultEnvelope(result, task.taskId).ok, true);
  const ingested = ingestWorkerResult(mem, cfg, result, task);
  assert.equal(ingested.persisted, 1);
  assert.equal(ingested.queuedActions, 1);
  assert.equal(mem.pendingActions().length, 1);
  assert.equal(mem.pendingActions()[0].payload_json._guai.level, 2);
  assert.equal(mem.pendingActions()[0].payload_json._guai.approvalRequired, true);
  mem.close();
});

test('risk policy never downgrades task risk or dangerous action kinds', () => {
  assert.equal(actionRiskLevel({ kind: 'write_note', riskLevel: 0 }, 0), 1);
  assert.equal(actionRiskLevel({ kind: 'send_email', riskLevel: 0 }, 0), 2);
  assert.equal(actionRiskLevel({ kind: 'deploy', riskLevel: 0 }, 0), 3);
  assert.equal(actionRiskLevel({ kind: 'write_note', riskLevel: 0 }, 3), 3);
  assert.equal(riskPolicy(3).autoExecute, false);
});

test('memory persists delegated tasks, traces, and catalog', () => {
  const mem = openMemory(':memory:');
  const task = makeTaskEnvelope({ objective: 'Research' });
  mem.createAgentTask(task);
  mem.updateAgentTask(task.taskId, { status: 'completed', result: { ok: true }, worker: 'researcher' });
  mem.addExecutionTrace({ traceId: 'trace-x', taskId: task.taskId, worker: 'researcher', status: 'completed', metrics: { cost: 1 } });
  assert.equal(mem.syncComponentCatalog({ agents: [{ name: 'orchestrator' }], skills: ['topic-research'] }), 2);
  assert.equal(mem.agentTasks()[0].status, 'completed');
  assert.equal(mem.executionTraces()[0].metrics_json.cost, 1);
  assert.equal(mem.componentCatalog().length, 2);
  mem.close();
});
