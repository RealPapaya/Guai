import { randomUUID } from 'node:crypto';
import { secret } from './config.js';
import { validateResultEnvelope, validateTaskEnvelope } from './bridge-contract.js';

export function makeTaskEnvelope(input) {
  const task = {
    taskId: input.taskId ?? randomUUID(),
    parentTaskId: input.parentTaskId ?? null,
    objective: input.objective,
    taskType: input.taskType ?? 'research',
    difficulty: input.difficulty ?? 'complex',
    riskLevel: input.riskLevel ?? 0,
    contextRefs: input.contextRefs ?? [],
    allowedCapabilities: input.allowedCapabilities ?? [],
    deadline: input.deadline ?? null,
    budget: input.budget ?? { maxTurns: 10, maxCostUsd: 1 },
    preferredWorker: input.preferredWorker ?? null,
  };
  const checked = validateTaskEnvelope(task);
  if (!checked.ok) throw new Error(`Invalid task envelope: ${checked.errors.join('; ')}`);
  return task;
}

export class SidecarClient {
  constructor({ baseUrl = 'http://127.0.0.1:8765', timeoutMs = 120_000, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = 'GET', body = null } = {}) {
    const token = secret('GUAI_SIDECAR_TOKEN');
    const headers = { accept: 'application/json' };
    if (body != null) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Worker sidecar returned non-JSON (${response.status}): ${text.slice(0, 300)}`); }
    if (!response.ok) throw new Error(parsed.error ?? `Worker sidecar request failed (${response.status})`);
    return parsed;
  }

  health() {
    return this.request('/health');
  }

  catalog() {
    return this.request('/catalog');
  }

  async dispatch(task) {
    const checked = validateTaskEnvelope(task);
    if (!checked.ok) throw new Error(`Invalid task envelope: ${checked.errors.join('; ')}`);
    const result = await this.request('/tasks', { method: 'POST', body: task });
    const valid = validateResultEnvelope(result, task.taskId);
    if (!valid.ok) throw new Error(`Invalid sidecar result: ${valid.errors.join('; ')}`);
    return result;
  }
}
