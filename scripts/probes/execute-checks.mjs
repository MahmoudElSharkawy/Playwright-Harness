// Acceptance proof names; these do not compute scenario verdicts.
export const requiredExecuteChecks = Object.freeze(['snapshot-refs', 'rendered-reads', 'modal-and-type', 'login-reuse', 'no-secret-leaks', 'checked-observed-mixed', 'fail-finality', 'asynchronous-artifact-binding', 'integrity-stop', 'provenance-budget', 'diagnostics-modes', 'read-retry', 'mutation-reconciliation', 'cleanup-lifecycle', 'killed-host-recovery']);
export const retryProbeStages = Object.freeze(['start', 'first-navigation', 'end-first-attempt', 'await-retry', 'retry-navigation', 'retry-check', 'end-retry', 'assessment', 'attempt-count']);
export function retryProbeDiagnostic(input) {
  if (!retryProbeStages.includes(input?.stage)) return undefined;
  const result = {stage: input.stage}, statuses = ['OK', 'ERROR', 'PASS', 'FAIL', 'INDETERMINATE', 'BLOCKED', 'NEEDS_REVIEW', 'READY', 'FINISHING', 'FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE', 'STOPPING'];
  for (const key of ['hostState', 'actual']) if (statuses.includes(input[key])) result[key] = input[key];
  for (const key of ['attempt', 'actual']) if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 3) result[key] = input[key];
  return result;
}
export function completeExecuteChecks(checks) {
  return Array.isArray(checks) && checks.length === requiredExecuteChecks.length && new Set(checks.map(check => check.name)).size === checks.length
    && requiredExecuteChecks.every(name => checks.some(check => check.name === name && check.status === 'PASS'));
}
