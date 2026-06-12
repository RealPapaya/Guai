import { gateAndPersist } from './sweep.js';
import { mergeAndDedupe } from '../workflows/lib/collect.js';
import { validateFindings } from '../workflows/lib/schemas.js';
import { validateResultEnvelope } from './bridge-contract.js';
import { actionRiskLevel, riskPolicy } from './risk.js';

function queueAction(mem, action, fallbackRationale, task) {
  if (!action?.kind || !action.payload) return false;
  const policy = riskPolicy(actionRiskLevel(action, task?.riskLevel));
  mem.enqueueAction({
    kind: action.kind,
    payload: {
      ...action.payload,
      _guai: { taskId: task?.taskId ?? null, ...policy },
    },
    rationale: action.rationale ?? fallbackRationale,
  });
  return true;
}

export function ingestWorkerResult(mem, cfg, result, task = null) {
  const checked = validateResultEnvelope(result, task?.taskId ?? null);
  if (!checked.ok) throw new Error(`Invalid worker result: ${checked.errors.join('; ')}`);

  const { valid, invalid } = validateFindings(result.findings ?? []);
  const merged = mergeAndDedupe([valid]);
  const ctx = mem.loadRunContext();
  const gated = gateAndPersist(mem, cfg, merged, ctx);

  let queued = 0;
  for (const finding of gated.decided) {
    if (queueAction(mem, finding.detail?.proposedAction, finding.title, task)) queued++;
  }
  for (const action of result.proposedActions ?? []) {
    if (queueAction(mem, action, result.summary || 'Worker proposal', task)) queued++;
  }

  return {
    persisted: gated.persisted.length,
    byAction: gated.byAction,
    queuedActions: queued,
    invalid: invalid.length,
    invalidDetail: invalid.slice(0, 5),
  };
}
