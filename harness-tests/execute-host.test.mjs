import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync, rmSync} from 'node:fs';
import {executionFixture} from './fixtures/execute.mjs';
import {startScenario, runHostedScenario, runInput} from '../scripts/lib/execute/host.mjs';
import {controlDirectory, sendCommand, delay} from '../scripts/lib/execute/mailbox.mjs';
import {readBounded, readFrozen, ownedFile, writeJson, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {collectExecution, writeExecutionReport} from '../scripts/lib/execute/report.mjs';
import {processInventory} from '../scripts/lib/browser/processes.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {acquireLauncher, lockStatus, releaseHost} from '../scripts/lib/execute/lock.mjs';
test('detached API-only host completes, reassesses, reports, and needs no browser or unrelated secrets', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); const started = await startScenario(f.roots, f.executionId, {readyTimeoutMs: 15000}); assert.equal(started.status, 'READY');
  const directory = controlDirectory(f.roots, f.executionId, started.runId), reply = await sendCommand(directory, started.runId, ['begin-step', 's001'], {timeoutMs: 10000}); assert.equal(reply.status, 'STEP_COMPLETE'); assert.equal(reply.assertions[0].status, 'PASS');
  for (let i = 0; i < 100 && readBounded(join(directory, 'host.json')).state !== 'FINISHED'; i++) await delay(50);
  const view = collectExecution(f.roots, f.executionId); assert.equal(view.scenarios[0].status, 'PASS'); assert.equal(view.runs[0].result.scenarios[0].resources.length, 0); assert.equal(f.requests.length, 1);
  const report = writeExecutionReport(f.roots, f.executionId); assert.equal(report.status, 'WRITTEN'); assert.equal(report.scenarios[0].methods.checked, 1);
  const pid = readBounded(join(directory, 'host.json')).pid; for (let i = 0; i < 10 && (await processInventory()).some(item => item.pid === pid); i++) await delay(100);
});

for (const retain of [false, true]) test(`mailbox persistence failure aborts runtime before ${retain ? 'retaining incomplete cleanup ownership' : 'releasing cleaned ownership'}`, async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); const loaded = readFrozen(f.roots, f.executionId), runId = 'run-mailbox-fault';
  const input = runInput(loaded.freeze, loaded.source.scenarios[0], loaded.freeze.scenarios[0], runId), run = createRun(input);
  writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, runId, scenarioId: loaded.source.scenarios[0].id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input}, {exclusive: true});
  saveExecution(f.roots, f.executionId, {...loaded.execution, runs: [{runId, scenarioId: loaded.source.scenarios[0].id, state: 'STARTING', startedAt: input.startedAt}]});
  const owner = await acquireLauncher(f.roots, {executionId: f.executionId, runId}); let signal, settled = false;
  const protectedPath = ownedFile(f.roots, f.executionId, `${runId}/protected`);
  const runtime = async (run, roots, options) => {signal = options.signal; mkdirSync(protectedPath, {recursive: true}); return new Promise(resolve => {signal.addEventListener('abort', () => {setTimeout(() => {if (!retain) rmSync(protectedPath, {recursive: true}); settled = true; resolve({status: 'BLOCKED'});}, 20);}, {once: true});});};
  const mailboxFactory = () => ({save() {}, take() {throw new Error('Mailbox persistence failure');}});
  await assert.rejects(runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {runtime, mailboxFactory}), /Mailbox persistence failure/);
  assert.equal(signal.aborted, true); assert.equal(settled, true);
  const remaining = await lockStatus(f.roots); assert.equal(Boolean(remaining), retain);
  if (retain) {assert.equal(remaining.nonce, owner.nonce); rmSync(protectedPath, {recursive: true}); await releaseHost(f.roots, owner.nonce);}
});
