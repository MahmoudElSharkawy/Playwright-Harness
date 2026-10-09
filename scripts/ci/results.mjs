// CI evidence checks only. These never compute a scenario verdict.
import {completeBrowserChecks, requiredBrowserChecks} from '../probes/browser-checks.mjs';
import {completeExecuteChecks, requiredExecuteChecks, retryProbeDiagnostic} from '../probes/execute-checks.mjs';
import {parallelDiagnostic} from '../probes/parallel-diagnostics.mjs';

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
export function nativeSummaryFields(kind, assessment, cleanup, failure) {
  const numeric = (input, names) => Object.fromEntries(names.filter(name => Number.isFinite(input?.[name]) && input[name] >= 0).map(name => [name, input[name]]));
  if (kind === 'execute') return {diagnosticsLatencyMs: numeric(assessment?.diagnosticsLatencyMs, ['end', 'per-step'])};
  if (kind !== 'parallel') return {};
  const diagnostic = parallelDiagnostic(failure);
  return {checks: (assessment?.counts ?? []).slice(0, 2).map(item => numeric(item, ['scenarios', 'assertions', 'evidence'])), ...(diagnostic ? {failure: diagnostic} : {}),
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
/** Failure metadata is allow-listed; messages, values, names and full paths stay private. */
export function testFailureDiagnostics(output, files) {
  const allowed = {
    failureType: ['testCodeFailure', 'testTimeoutFailure', 'cancelledByParent', 'subtestsFailed', 'hookFailed'],
    code: ['ERR_ASSERTION', 'ERR_TEST_FAILURE', 'ENOENT', 'EEXIST', 'EPERM', 'EACCES', 'EBUSY', 'ETIMEDOUT', 'ABORT_ERR'],
    operator: ['strictEqual', 'deepStrictEqual', 'notStrictEqual', 'notDeepStrictEqual', 'deepEqual', 'notDeepEqual', '==', '!=', '===', '!==', 'fail', 'throws', 'rejects', 'ifError', 'match', 'doesNotMatch']
  };
  const coordinate = source => {
    const match = source.match(/([^\\/]+):(\d+):(\d+)\)?$/);
    if (!match) return undefined;
    const [, file, row, col] = match, line = Number(row), column = Number(col);
    return files.includes(file) && Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(column) && column > 0 ? {file, line, column} : undefined;
  };
  const failures = [];
  for (const match of output.matchAll(/^\s*not ok [^\r\n]*\r?\n([\s\S]*?)^\s*\.\.\.\r?$/gm)) {
    const block = match[1], location = coordinate(block.match(/^\s+location: ['"]([^\r\n]+)['"]\r?$/m)?.[1] ?? '');
    if (!location) continue;
    const failure = {location};
    for (const [field, values] of Object.entries(allowed)) {
      const value = block.match(new RegExp(`^\\s+${field}: ['"]?([^'"\\r\\n]+)['"]?\\r?$`, 'm'))?.[1];
      if (values.includes(value)) failure[field] = value;
    }
    const durationMs = Number(block.match(/^\s+duration_ms: (\d+(?:\.\d+)?)\r?$/m)?.[1]);
    if (Number.isFinite(durationMs) && durationMs >= 0) failure.durationMs = durationMs;
    const stack = block.match(/^\s+stack: \|[^\r\n]*\r?\n([\s\S]*)/m)?.[1] ?? '';
    const stackLocation = stack.split(/\r?\n/).map(line => coordinate(line.trim())).find(Boolean);
    if (stackLocation) failure.stackLocation = stackLocation;
    failures.push(failure); if (failures.length === 100) break;
  }
  return failures;
}
export function completeNativeProof(kind, proof, recovery, assessment, cleanup) {
  return proof?.status === 'PASS' && recovery?.complete === true && assessment?.status === 'PASS' &&
    (kind === 'browser' ? completeBrowserChecks(assessment.checks) : kind === 'execute' ? completeExecuteChecks(assessment.checks) && assessment.fixtureServersClosed === true && ['end', 'per-step'].every(mode => Number.isFinite(assessment.diagnosticsLatencyMs?.[mode]) && assessment.diagnosticsLatencyMs[mode] >= 0) : kind === 'parallel' &&
      assessment.comparison?.status === 'PASS' && Array.isArray(assessment.counts) && assessment.counts.length === 2 &&
      assessment.counts.every(count => count.scenarios === 13 && count.assertions > 0 && count.evidence > 0) &&
      cleanup?.ownedDatabasesRemoved === true && cleanup?.fixtureServersClosed === true);
}
export const requiredChecks = Object.freeze(['syntax', 'json', 'links', 'privacy', 'secrets', 'provenance', 'publication', 'contracts', 'conventions', 'generation-conventions', 'workflow-conventions', 'types', 'fetch', 'tests']);
export const requiredConsumerFlows = Object.freeze(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'F1', 'F2', 'F3']);
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
