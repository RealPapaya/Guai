const LEVEL_3 = new Set([
  'delete', 'delete_file', 'delete_account', 'payment', 'purchase',
  'deploy', 'merge', 'publish', 'release', 'push_commit',
]);

const LEVEL_2 = new Set([
  'send_email', 'send_message', 'github_comment', 'calendar_event',
  'create_issue', 'update_remote',
]);

const LEVEL_1 = new Set([
  'write_note', 'update_local', 'create_draft', 'store_memory',
]);

export function actionRiskLevel(action, taskRiskLevel = 0) {
  const kind = String(action?.kind ?? '').toLowerCase();
  let inferred = 2; // Unknown outward actions default to confirmation-required.
  if (LEVEL_3.has(kind)) inferred = 3;
  else if (LEVEL_2.has(kind)) inferred = 2;
  else if (LEVEL_1.has(kind)) inferred = 1;
  return Math.max(inferred, action?.riskLevel ?? 0, taskRiskLevel ?? 0);
}

export function riskPolicy(level) {
  if (level >= 3) return { level: 3, approvalRequired: true, autoExecute: false, label: 'high-risk' };
  if (level === 2) return { level: 2, approvalRequired: true, autoExecute: false, label: 'external-change' };
  if (level === 1) return { level: 1, approvalRequired: false, autoExecute: true, label: 'reversible-internal' };
  return { level: 0, approvalRequired: false, autoExecute: true, label: 'read-only' };
}
