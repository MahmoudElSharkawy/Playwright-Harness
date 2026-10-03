// Acceptance proof names; these do not compute scenario verdicts.
export const requiredExecuteChecks = Object.freeze(['login-reuse', 'no-secret-leaks', 'checked-observed-mixed', 'fail-finality', 'asynchronous-artifact-binding', 'integrity-stop', 'provenance-budget', 'diagnostics-modes', 'read-retry', 'mutation-reconciliation', 'cleanup-lifecycle', 'killed-host-recovery']);
export function completeExecuteChecks(checks) {
  return Array.isArray(checks) && checks.length === requiredExecuteChecks.length && new Set(checks.map(check => check.name)).size === checks.length
    && requiredExecuteChecks.every(name => checks.some(check => check.name === name && check.status === 'PASS'));
}
