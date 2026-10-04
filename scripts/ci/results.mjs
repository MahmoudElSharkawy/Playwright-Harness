// CI evidence checks only. These never compute a scenario verdict.
import {completeBrowserChecks, requiredBrowserChecks} from '../probes/browser-checks.mjs';
import {completeExecuteChecks, requiredExecuteChecks, retryProbeDiagnostic} from '../probes/execute-checks.mjs';

export function browserDiagnostics(assessment) {
  return Array.isArray(assessment?.checks) ? assessment.checks
    .filter(check => requiredBrowserChecks.includes(check?.name) && ['PASS', 'FAIL'].includes(check.status))
    .map(({name, status}) => ({name, status})) : [];
}
export function executeDiagnostics(assessment) {
  return Array.isArray(assessment?.checks) ? assessment.checks.filter(check => requiredExecuteChecks.includes(check?.name) && ['PASS', 'FAIL'].includes(check.status)).map(check => {
    const result = {name: check.name, status: check.status}, diagnostic = retryProbeDiagnostic(check.diagnostic);
    if (check.name === 'read-retry' && check.status === 'FAIL' && diagnostic) result.diagnostic = diagnostic;
    return result;
  }) : [];
}
export function nativeSummaryFields(kind, assessment, cleanup) {
  const numeric = (input, names) => Object.fromEntries(names.filter(name => Number.isFinite(input?.[name]) && input[name] >= 0).map(name => [name, input[name]]));
  if (kind === 'execute') return {diagnosticsLatencyMs: numeric(assessment?.diagnosticsLatencyMs, ['end', 'per-step'])};
  if (kind !== 'parallel') return {};
  return {checks: (assessment?.counts ?? []).slice(0, 2).map(item => numeric(item, ['scenarios', 'assertions', 'evidence'])),
    ...(cleanup ? {cleanup: {ownedDatabasesRemoved: cleanup.ownedDatabasesRemoved === true, fixtureServersClosed: cleanup.fixtureServersClosed === true}} : {})};
}
/** Only known source filenames and numeric locations leave the private TAP log. */
export function testFailureLocations(output, files) {
  const locations = new Map();
  for (const match of output.matchAll(/^\s+location: ['"]([^\r\n]+):(\d+):(\d+)['"]\r?$/gm)) {
    const file = match[1].split(/[\\/]/).at(-1), line = Number(match[2]), column = Number(match[3]);
    if (files.includes(file) && Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(column) && column > 0) locations.set(`${file}:${line}:${column}`, {file, line, column});
  }
  return [...locations.values()].slice(0, 100);
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
