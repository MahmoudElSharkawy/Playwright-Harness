// CI evidence checks only. These never compute a scenario verdict.
export const requiredChecks = Object.freeze(['syntax', 'json', 'links', 'privacy', 'secrets', 'provenance', 'publication', 'contracts', 'conventions', 'generation-conventions', 'workflow-conventions', 'types', 'fetch', 'tests']);
export function testCounts(output) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, Number(output.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN)]));
}
export function completeTests(counts) {
  return Object.values(counts).every(Number.isSafeInteger) && counts.tests > 0 && counts.pass === counts.tests && ['fail', 'cancelled', 'skipped', 'todo'].every(name => counts[name] === 0);
}
export function completeChecks(checks) {
  return checks.length === requiredChecks.length && new Set(checks.map(check => check.id)).size === requiredChecks.length &&
    requiredChecks.every(id => checks.some(check => check.id === id && check.status === 'PASS' && check.exitCode === 0 && !check.diagnostic && (id !== 'tests' || completeTests(check.counts ?? {}))));
}
