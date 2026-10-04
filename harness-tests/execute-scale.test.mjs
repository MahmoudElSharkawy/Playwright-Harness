import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {executionFixture} from './fixtures/execute.mjs';
import {fakeNative} from './fixtures/fake-native.mjs';
import {freezeExecution} from '../scripts/lib/execute/refinement.mjs';
import {readFrozen, writeJson, ownedFile, saveExecution, EXECUTION_DOCUMENT} from '../scripts/lib/execute/storage.mjs';
import {runInput} from '../scripts/lib/execute/host.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {runSequentialScenario} from '../scripts/lib/sequential/index.mjs';
import {VerdictLedger, assertionEvidence} from '../scripts/lib/execute/verdicts.mjs';
import {writeExecutionReport} from '../scripts/lib/execute/report.mjs';
import {setImmediate} from 'node:timers/promises';

test('S1 S7: 500 ten-step scenarios execute, reassess and report without host launches', {timeout: 300000}, async t => {
  const started = performance.now(), counters = {steps: 0, nativeCalls: 0, hostLaunches: 0, processListings: 0, artifacts: 0};
  const cases = Array.from({length: 500}, (_, index) => ({id: index + 1, rev: 1, title: `Scale case ${index + 1}`, parameters: null,
    steps: Array.from({length: 10}, () => ({action: 'Inspect Save', expected: 'Save is disabled'}))}));
  const f = await executionFixture(t, {browser: true, cases});
  for (const scenario of f.refinement.scenarios) for (const step of scenario.steps) {
    step.capability = 'reads'; step.readOnlyContract = {reason: 'Inspect fixed scale fixture.'};
    for (const expected of step.expectations) expected.conditions = [{text: expected.conditions[0].text, predicate: 'state:disabled', subject: {element: {role: 'button', name: 'Save'}}, expected: null, precondition: false, exact: false, ambiguous: false}];
  }
  writeJson(ownedFile(f.roots, f.executionId, 'refinement.json'), f.refinement, EXECUTION_DOCUMENT);
  freezeExecution(f.roots, f.executionId);
  t.diagnostic(`Prepared and froze in ${Math.round(performance.now() - started)} ms`);
  const loaded = readFrozen(f.roots, f.executionId), source = new Map(loaded.source.scenarios.map(item => [item.id, item])), runs = [], native = fakeNative({synchronousFiles: true});
  // Guard the real library path: introducing a host or inventory subprocess fails this fixture.
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) t.mock.method(childProcess, method, () => {counters.hostLaunches++; throw new Error('Scale fixture cannot launch processes.');});
  syncBuiltinESMExports(); t.after(() => {t.mock.restoreAll(); syncBuiltinESMExports();});
  for (const scenario of loaded.freeze.scenarios) {
    await setImmediate();
    t.signal.throwIfAborted();
    const runId = `run-${randomUUID()}`, input = runInput(loaded.freeze, source.get(scenario.id), scenario, runId), run = createRun(input);
    const roots = {...f.roots, runRoot: ownedFile(f.roots, f.executionId, runId)};
    writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, scenarioId: scenario.id, runId, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input, explicitRerun: false}, {exclusive: true});
    const result = await runSequentialScenario(run, roots, {browser: {target: 'ui', nativeSession: native.factory}}, {exercise: async phase => {
      for (const step of scenario.steps) await phase.browser.attempt({operation: step.operation, invocationId: step.id}, async context => {
        counters.steps++;
        // Exercise the real core once per step. BrowserCommands and DOM extraction have
        // their own fixtures; scale supplies fixed native facts without redundant temporary CLI files.
        await context.native(['tab-list']);
        const text = '- button "Save" [disabled] [ref=e1]', snapshotId = await context.evidence('snapshot', {text});
        const ledger = new VerdictLedger(step.contracts, {verificationOnly: true});
        // This fixture supplies a snapshot, not a page DOM. Ground the observation
        // in that artifact; deterministic /2 reads and large-value checks have separate tests.
        for (const contract of step.contracts) ledger.observed(contract.key, contract.index, {status: 'PASS', observed: 'Save is disabled', rationale: 'The synthetic native snapshot marks Save disabled.', whyNotChecked: 'not-readable', artifacts: [{id: snapshotId, kind: 'snapshot', text, stateVersion: 0}]});
        const assertions = [];
        for (const result of ledger.aggregate()) {const artifact = await context.evidence('assertion', assertionEvidence(result)); assertions.push({id: result.id, status: result.status, reliable: result.reliable, evidenceIds: [...result.evidenceIds, artifact]});}
        context.commit({assertions, effect: {certainty: 'none', resourceIds: []}});
      });
    }});
    assert.equal(result.status, 'PASS'); counters.artifacts += result.evidence.length;
    runs.push({runId, scenarioId: scenario.id, state: 'FINISHED', startedAt: input.startedAt, explicitRerun: false});
  }
  saveExecution(f.roots, f.executionId, {...loaded.execution, runs});
  t.diagnostic(`Executed in ${Math.round(performance.now() - started)} ms`);
  // Report generation calls the actual collector and reassesses every stored run.
  const report = writeExecutionReport(f.roots, f.executionId); assert.equal(report.scenarios.length, 500);
  await setImmediate(); t.signal.throwIfAborted();
  assert.equal(report.scenarios.filter(item => item.state === 'ASSESSED' && item.status === 'PASS').length, 500);
  counters.nativeCalls = native.calls.length;
  assert.equal(counters.steps, 5000); assert.equal(counters.nativeCalls, 5000); assert.equal(counters.hostLaunches, 0); assert.equal(counters.processListings, 0);
  assert(counters.artifacts <= 17000); assert.equal(native.sessions.length, 500);
  t.diagnostic(JSON.stringify({...counters, elapsedMs: Math.round(performance.now() - started)}));
});
