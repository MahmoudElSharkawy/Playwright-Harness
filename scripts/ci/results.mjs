// CI evidence checks only. These never compute a scenario verdict.
import {completeBrowserChecks, requiredBrowserChecks} from '../probes/browser-checks.mjs';
import {completeExecuteChecks} from '../probes/execute-checks.mjs';

export function browserDiagnostics(assessment) {
  return Array.isArray(assessment?.checks) ? assessment.checks
    .filter(check => requiredBrowserChecks.includes(check?.name) && ['PASS', 'FAIL'].includes(check.status))
    .map(({name, status}) => ({name, status})) : [];
}
export function completeNativeProof(kind, proof, recovery, assessment, cleanup) {
  return proof?.status === 'PASS' && recovery?.complete === true && assessment?.status === 'PASS' &&
    (kind === 'browser' ? completeBrowserChecks(assessment.checks) : kind === 'execute' ? completeExecuteChecks(assessment.checks) && assessment.fixtureServersClosed === true && ['end', 'per-step'].every(mode => Number.isFinite(assessment.diagnosticsLatencyMs?.[mode]) && assessment.diagnosticsLatencyMs[mode] >= 0) : kind === 'parallel' &&
      assessment.comparison?.status === 'PASS' && Array.isArray(assessment.counts) && assessment.counts.length === 2 &&
      assessment.counts.every(count => count.scenarios === 13 && count.assertions > 0 && count.evidence > 0) &&
      cleanup?.ownedDatabasesRemoved === true && cleanup?.fixtureServersClosed === true);
}
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
