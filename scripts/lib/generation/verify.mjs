import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {data, fingerprint, requireThat, integer, frozen} from '../execution-core/data.mjs';
import {transaction, relativeFile, snapshot} from './storage.mjs';
import {approvedCandidate} from './index.mjs';
import {readJson} from '../project-config.mjs';
import {allureLinkTemplates} from '../convention-source.mjs';

const reporter = fileURLToPath(new URL('./reporter.cjs', import.meta.url));
const reportingReporter = fileURLToPath(new URL('../reporting/verification-reporter.mjs', import.meta.url));
const identity = test => fingerprint([test.spec, test.project, test.titlePath]);

export function selectTests(candidate, report) {
  requireThat([1, 2].includes(report.version) && report.errors === 0 && Array.isArray(report.tests), 'Invalid native test collection.');
  const selected = candidate.tests.map(test => {
    const matches = report.tests.filter(actual => identity(actual) === identity(test));
    requireThat(matches.length === 1, 'Each source scenario must select one unique native test.');
    const match = matches[0];
    requireThat(match.expectedStatus === 'passed' && match.retries === 0 && match.repeatEachIndex === 0, 'Skipped, expected-failure, retried or repeated tests cannot verify generation.');
    return {...test, id: match.id, nativeFile: match.nativeFile};
  });
  requireThat(new Set(selected.map(t => t.id)).size === selected.length, 'Native test identities overlap.');
  // Playwright's native test list matches title-path prefixes. Check its entire
  // collected match set before dispatch so an unselected descendant cannot run.
  const selectedIds = new Set(selected.map(t => t.id));
  for (const selector of selected) {
    const matches = report.tests.filter(test => test.project === selector.project && test.nativeFile === selector.nativeFile &&
      selector.titlePath.length <= test.titlePath.length && selector.titlePath.every((title, index) => title === test.titlePath[index]));
    requireThat(matches.every(test => selectedIds.has(test.id)), 'Native test-list prefix would execute an unselected test.');
  }
  return selected;
}

/** Never count empty, partial, flaky, skipped, duplicated or assertion-free execution as green. */
export function assessVerification(handoff, selected, report, invocation, exitCode) {
  requireThat(report.invocation === invocation && exitCode === 0 && report.status === 'passed' && report.errors === 0 && report.workers === 1 && report.forbidOnly === true, 'Native verification did not complete cleanly.');
  requireThat(report.tests.length === selected.length, 'Native verification scope changed.');
  selectTests({tests: selected}, report);
  for (const test of selected) {
    const actual = report.tests.find(t => t.id === test.id && identity(t) === identity(test));
    requireThat(actual?.results.length === 1, 'Native test did not run exactly once.');
    const result = actual.results[0];
    requireThat(result.status === 'passed' && result.retry === 0 && result.errors === 0, 'Native test failed or retried.');
    if (report.version === 1) {
      const keys = handoff.expectations.filter(e => e.scenarioId === test.scenarioId).map(e => e.key).sort();
      requireThat(Array.isArray(result.expectations) && result.assertions === undefined && result.skippedSteps === undefined &&
        fingerprint(result.expectations.map(e => e.key).sort()) === fingerprint(keys) && result.expectations.every(e => e.assertions > 0 && !e.failed), 'Source assertions were missing, duplicated, empty or failed.');
    } else {
      requireThat(result.expectations === undefined && integer(result.assertions?.passed, 1) && integer(result.assertions?.failed) &&
        result.assertions.failed === 0 && integer(result.skippedSteps) && result.skippedSteps === 0, 'Case assertions were missing, failed or skipped.');
    }
  }
  return report.version === 1 ? {status: 'PASS', tests: selected.length, expectations: handoff.expectations.length}
    : {status: 'PASS', tests: selected.length, gate: 'case-assertions'};
}

function nativeRunner(roots) {
  const require = createRequire(join(roots.projectRoot, 'package.json'));
  const testPackage = require.resolve('@playwright/test/package.json'), nativePackage = require.resolve('playwright/package.json');
  const versions = [testPackage, nativePackage].map(path => JSON.parse(readFileSync(path, 'utf8')).version);
  requireThat(versions.every(version => version === '1.63.0'), 'The generation verification adapter requires the validated Playwright Test 1.63.0 installation.');
  return {cli: join(dirname(nativePackage), 'cli.js'), version: versions[0]};
}

async function command(roots, cli, args, environment, timeoutMs) {
  return new Promise(resolve => {
    let timedOut = false, timer;
    const child = spawn(process.execPath, [cli, 'test', ...args], {cwd: roots.projectRoot, windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore', env: {...process.env, ...environment}});
    child.once('error', () => {clearTimeout(timer); resolve({exitCode: null, timedOut: false});});
    child.once('close', code => {clearTimeout(timer); resolve({exitCode: code, timedOut});});
    timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true, timeout: 10000});
      else try {process.kill(-child.pid, 'SIGKILL');} catch { /* close/error records the incomplete invocation */ }
    }, timeoutMs);
  });
}

export async function verifyGeneration(roots, sourceId, {timeoutMs = 120000, allure = false} = {}) {
  requireThat(integer(timeoutMs, 5000, 600000), 'Verification timeout must be bounded.');
  requireThat(typeof allure === 'boolean', 'Allure capture is an explicit boolean option.');
  // Persist invocation intent before dispatch. A crash never turns into an absent attempt.
  return transaction(roots, sourceId, async (state, save, directory) => {
    const candidate = approvedCandidate(roots, state), prior = state.runs.filter(r => r.revision === candidate.revision);
    requireThat(!prior.some(r => r.status !== 'PASS'), 'Repair/review the failed or interrupted candidate before another verification; no retry-to-green.');
    requireThat(prior.length < 2, 'Two independent green runs are already recorded.');
    const record = {id: `verify-${randomUUID()}`, revision: candidate.revision, gate: 'case-assertions', status: 'STARTED', startedAt: Date.now()};
    state.runs.push(record); save(state); const invocation = record;
    let phase = 'PREPARATION', failureStatus = 'BLOCKED', links = {state: 'NONE'};
    try {
      const candidate = approvedCandidate(roots, state), native = nativeRunner(roots);
      const output = join(directory, invocation.id); mkdirSync(output, {mode: 0o700});
      const listReceipt = join(output, 'collection.json'), runReceipt = join(output, 'execution.json');
      if (allure) {
        try {links = allureLinkTemplates(readFileSync(relativeFile(roots, candidate.config), 'utf8'));}
        catch {links = {state: 'UNRESOLVED'};}
      }
      const shared = ['--config', relativeFile(roots, candidate.config), '--reporter', reporter, '--workers', '1', '--retries', '0', '--repeat-each', '1', '--forbid-only', '--no-deps', '--global-timeout', String(timeoutMs - 2000), '--output', join(output, 'artifacts')];
      const env = {HARNESS_GENERATION_INVOCATION: invocation.id, HARNESS_GENERATION_RECEIPT: listReceipt,
        HARNESS_ALLURE_LINKS: links.state === 'CONFIGURED' ? JSON.stringify(links.links) : ''};
      const files = [...new Set(candidate.tests.map(t => relativeFile(roots, t.spec).replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))];
      phase = 'COLLECTION'; const collection = await command(roots, native.cli, [...shared, '--list', ...files], env, timeoutMs);
      requireThat(collection.exitCode === 0 && !collection.timedOut, 'Native test collection failed.');
      const collected = data(readJson(listReceipt));
      requireThat(collected.version === 2 && collected.invocation === invocation.id, 'Collection receipt version or identity changed.');
      const selected = selectTests(candidate, collected);
      const testList = join(output, 'scope.txt');
      for (const test of selected) requireThat(typeof test.nativeFile === 'string' && !/[\r\n›<>]/.test(test.nativeFile), 'Invalid native file identity.');
      writeFileSync(testList, selected.map(t => `[${t.project}] › ${t.nativeFile} › ${t.titlePath.join(' › ')}`).join('\n'), {flag: 'wx', mode: 0o600});
      requireThat(snapshot(roots).fingerprint === candidate.snapshot.fingerprint, 'Collection changed frozen consumer files.');
      phase = 'EXECUTION'; failureStatus = 'NEEDS_REVIEW';
      const executionArgs = [...shared, '--test-list', testList];
      if (allure) executionArgs[executionArgs.indexOf('--reporter') + 1] = reportingReporter;
      const execution = await command(roots, native.cli, executionArgs, {...env, HARNESS_GENERATION_RECEIPT: runReceipt,
        HARNESS_ALLURE_DIRECTORY: `reports/generation/${invocation.id}`}, timeoutMs);
      const report = data(readJson(runReceipt));
      requireThat(report.version === 2, 'New verification requires case-level assertion receipts.');
      requireThat(!execution.timedOut && snapshot(roots).fingerprint === candidate.snapshot.fingerprint, 'Execution changed files or exceeded its deadline.');
      approvedCandidate(roots, state);
      phase = 'ASSERTION_COVERAGE';
      if (report.tests?.some(t => t.results?.some(r => r.status === 'failed' || r.assertions?.failed > 0))) failureStatus = 'FAIL';
      Object.assign(record, assessVerification(state.handoff, selected, report, invocation.id, execution.exitCode), {runner: native.version,
        receipt: {path: `.harness/state/generation/${sourceId}/${invocation.id}/execution.json`, fingerprint: fingerprint(report)}});
    } catch {record.status = failureStatus; record.failureClass = phase; record.reason = 'Inspect protected native receipts and the named gate; raw errors are withheld.';}
    if (allure) {
      try {
        const path = `reports/generation/${invocation.id}`, capture = data(readJson(relativeFile(roots, `${path}/capture.json`)));
        record.reporting = {status: capture.status === 'CAPTURED' ? 'CAPTURED' : 'FAILED', directory: path, source: 'playwright-native', links: links.state,
          ...(['PLACEHOLDER', 'UNRESOLVED'].includes(links.state) ? {linksDiagnostic: 'Scoped Allure links were omitted; configure literal reporter templates.'} : {})};
        writeFileSync(relativeFile(roots, `${path}/verification.json`), JSON.stringify({sourceId, invocation: invocation.id, revision: record.revision, status: record.status,
          gate: record.gate,
          ...(record.failureClass ? {failureClass: record.failureClass} : {})}), {flag: 'wx', mode: 0o600});
      } catch {record.reporting = {status: 'FAILED', links: links.state, reason: 'Optional Allure capture unavailable; verification verdict unchanged.'};}
    }
    record.endedAt = Date.now(); save(state); return frozen(record);
  });
}
