const TASK_TYPES = new Set(['monitor', 'research', 'compose', 'execute']);
const DIFFICULTIES = new Set(['deterministic', 'simple', 'complex', 'expert']);
const TASK_STATUSES = new Set(['queued', 'running', 'waiting', 'completed', 'failed', 'blocked', 'cancelled', 'needs_approval']);
const RESULT_STATUSES = new Set(['completed', 'failed', 'blocked', 'needs_approval']);

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export function validateTaskEnvelope(task) {
  const errors = [];
  if (!isObj(task)) return { ok: false, errors: ['task must be an object'] };
  if (typeof task.taskId !== 'string' || !task.taskId) errors.push('taskId is required');
  if (task.parentTaskId != null && typeof task.parentTaskId !== 'string') errors.push('parentTaskId must be a string or null');
  if (typeof task.objective !== 'string' || !task.objective.trim()) errors.push('objective is required');
  if (!TASK_TYPES.has(task.taskType)) errors.push(`taskType must be one of ${[...TASK_TYPES].join('|')}`);
  if (!DIFFICULTIES.has(task.difficulty)) errors.push(`difficulty must be one of ${[...DIFFICULTIES].join('|')}`);
  if (!Number.isInteger(task.riskLevel) || task.riskLevel < 0 || task.riskLevel > 3) errors.push('riskLevel must be an integer from 0 to 3');
  if (task.contextRefs != null && !Array.isArray(task.contextRefs)) errors.push('contextRefs must be an array');
  if (task.allowedCapabilities != null && !Array.isArray(task.allowedCapabilities)) errors.push('allowedCapabilities must be an array');
  if (task.budget != null && !isObj(task.budget)) errors.push('budget must be an object');
  return { ok: errors.length === 0, errors };
}

export function validateResultEnvelope(result, taskId = null) {
  const errors = [];
  if (!isObj(result)) return { ok: false, errors: ['result must be an object'] };
  if (typeof result.taskId !== 'string' || !result.taskId) errors.push('taskId is required');
  if (taskId && result.taskId !== taskId) errors.push(`taskId mismatch: expected ${taskId}`);
  if (!RESULT_STATUSES.has(result.status)) errors.push(`status must be one of ${[...RESULT_STATUSES].join('|')}`);
  if (result.summary != null && typeof result.summary !== 'string') errors.push('summary must be a string');
  if (result.findings != null && !Array.isArray(result.findings)) errors.push('findings must be an array');
  if (result.proposedActions != null && !Array.isArray(result.proposedActions)) errors.push('proposedActions must be an array');
  if (result.artifacts != null && !Array.isArray(result.artifacts)) errors.push('artifacts must be an array');
  if (result.metrics != null && !isObj(result.metrics)) errors.push('metrics must be an object');
  return { ok: errors.length === 0, errors };
}

export function validateTaskStatus(status) {
  return TASK_STATUSES.has(status);
}

export const BRIDGE_CONTRACT = Object.freeze({
  taskTypes: [...TASK_TYPES],
  difficulties: [...DIFFICULTIES],
  taskStatuses: [...TASK_STATUSES],
  resultStatuses: [...RESULT_STATUSES],
});
