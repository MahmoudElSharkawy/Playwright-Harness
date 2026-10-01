// Exact fixed acceptance scope, shared by the native proof and installed-package gate.
import {unreachedCases} from '../../harness-tests/fixtures/browser-unreached.mjs';
export const requiredBrowserChecks = Object.freeze([
  'success-evidence', 'assertion-failure', 'outage', 'safe-recovery', 'uncertain-mutation', 'daemon-crash',
  'authentication-restore', 'stale-authentication', 'cancellation', 'cancellation-between-commands',
  'callback-deadline', 'body-deadline', 'deadline-before-required-invocation', 'policy-refusal-after-deadline',
  'sanitizer-deadline', 'unawaited-native-work', 'expired-attempt-context', 'assertion-history-preserved',
  'intentional-persistence', 'earlier-effect-claim-invalidated', 'cleanup-failure-preserved',
  'temporary-fixture-lifecycle', 'exhausted-cleanup-window', 'unrelated-session-retained', 'seed-cleanup', 'package-immutable',
  ...unreachedCases.map(item => item.name)
]);
export function completeBrowserChecks(checks) {
  return Array.isArray(checks) && checks.length === requiredBrowserChecks.length &&
    new Set(checks.map(item => item.name)).size === requiredBrowserChecks.length &&
    checks.every(item => requiredBrowserChecks.includes(item.name) && item.status === 'PASS');
}
