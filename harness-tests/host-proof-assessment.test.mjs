import test from 'node:test';
import assert from 'node:assert/strict';
import {assessNativeHost} from '../scripts/lib/host-proof-assessment.mjs';
import {reviewedInvocation} from '../scripts/lib/host-proof-assessment.mjs';
import {snapshotInstalledPackage} from '../scripts/lib/host-proof-files.mjs';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {observeHostProcess} from '../scripts/lib/host-proof-processes.mjs';
const digest = 'a'.repeat(64);
const script = resolve('fixture-package/host-command.mjs'), command = `node "${script}" execute`, expectedCases = 19;
function proof(host) {
  const output = JSON.stringify({receipt: 'M11_EXECUTION_RECEIPT', sha256: digest, cases: expectedCases});
  const events = host === 'codex' ? [{type: 'turn.completed'}, {type: 'item.completed', item: {type: 'command_execution', command, exit_code: 0, aggregated_output: output}}]
    : [{type: 'result', is_error: false}, {type: 'assistant', message: {content: [{type: 'tool_use', id: 'native', name: 'Bash', input: {command}}]}},
      {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'native', is_error: false, content: output}]}}];
  const hooks = [{host, session: 'one', event: 'SessionStart', stage: 'other', exitCode: 0, mappedModes: ['session-start']}, {host, session: 'one', event: 'PreToolUse', stage: 'deny', reviewedCommand: true, toolUse: 'deny', exitCode: host === 'codex' ? 0 : 2, permissionDecision: host === 'codex' ? 'deny' : null},
    ...['ping', 'edit', 'execute'].flatMap(stage => ['PreToolUse', 'PostToolUse'].map(event => ({host, session: 'one', event, stage, toolUse: stage, reviewedCommand: true, exitCode: 0,
      mappedModes: event === 'PostToolUse' ? [stage === 'edit' ? 'post-edit' : 'post-bash'] : [],
      ...(stage === 'execute' && event === 'PostToolUse' ? {executionReceipt: {digest, cases: expectedCases}} : {})})))];
  return {host, processResult: {exitCode: 0, timedOut: false, packageUnchanged: true, version: 'synthetic'}, events, hooks, digest, script, expectedCases, deniedMarker: false, allowedMarker: true, editedFile: true, infrastructureCleanup: true, packageUnchanged: true};
}

test('Codex proof rejects mere exit codes, allow decisions and executed denials', () => {
  for (const mutate of [p => {p.hooks[1].permissionDecision = null; p.hooks[1].exitCode = 2;}, p => p.hooks[1].permissionDecision = 'allow', p => p.deniedMarker = true]) {
    const p = proof('codex'); mutate(p); assert.equal(assessNativeHost(p).status, 'FAIL');
  }
});
for (const host of ['claude', 'codex']) {
  test(`${host} accepts paired native command and hook receipts`, () => assert.equal(assessNativeHost(proof(host)).status, 'PASS'));
  test(`${host} final prose is never execution proof`, () => {
    const p = proof(host); p.events = [{type: 'turn.completed'}, {type: 'result', is_error: false}, {type: 'assistant', message: {content: [{type: 'text', text: `M11_EXECUTION_RECEIPT ${digest}`}]}}];
    assert.equal(assessNativeHost(p).status, 'FAIL');
  });
  test(`${host} rejects missing hooks, wrong sessions and unpaired tool IDs`, () => {
    for (const mutate of [p => p.hooks.splice(0), p => p.hooks[0].session = 'other', p => p.hooks.at(-1).toolUse = 'foreign']) {const p = proof(host); mutate(p); assert.equal(assessNativeHost(p).status, 'FAIL');}
  });
  test(`${host} rejects missing receipt, executed denial and failed cleanup`, () => {
    for (const fields of [{digest: 'b'.repeat(64)}, {deniedMarker: true}, {infrastructureCleanup: false}, {packageUnchanged: false}, {processResult: {exitCode: 0, timedOut: true, packageUnchanged: true}}]) assert.equal(assessNativeHost({...proof(host), ...fields}).status, 'FAIL');
  });
  test(`${host} rejects echo, wrong hook digest, reversed chronology and empty identities`, () => {
    for (const mutate of [p => {if (host === 'codex') p.events[1].item.command = `echo '${command}'`; else p.events[1].message.content[0].input.command = `echo '${command}'`;},
      p => p.hooks.at(-1).executionReceipt.digest = 'b'.repeat(64), p => p.hooks.reverse(), p => p.hooks.forEach(h => h.session = ''),
      p => p.hooks.forEach(h => h.toolUse = ''), p => p.hooks.at(-1).reviewedCommand = false, p => p.hooks.at(-1).executionReceipt.cases = 1,
      p => p.hooks.find(h => h.stage === 'edit' && h.event === 'PostToolUse').mappedModes = [], p => p.hooks.push(p.hooks.shift())]) {
      const p = proof(host); mutate(p); assert.equal(assessNativeHost(p).status, 'FAIL');
    }
  });
}
test('fixed native wrapper recognition rejects shell additions and different executables', () => {
  assert.equal(reviewedInvocation(command, script), 'execute');
  assert.equal(reviewedInvocation(`"C:/Runtime/pwsh.exe" -Command ${JSON.stringify(command)}`, script), 'execute');
  assert.equal(reviewedInvocation(`/bin/bash -lc '${command}'`, script), 'execute');
  for (const text of [`echo '${command}'`, `${command}; echo misleading`, command.replace('host-command', 'other-command'), `node -e ${JSON.stringify(command)}`]) assert.equal(reviewedInvocation(text, script), null);
});
test('installed package snapshots include dependency executable changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'harness-m11-snapshot-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'node_modules/dependency'), {recursive: true}); writeFileSync(join(root, 'package.json'), '{}');
  const executable = join(root, 'node_modules/dependency/index.mjs'); writeFileSync(executable, 'export const value = 1;');
  const before = snapshotInstalledPackage(root); writeFileSync(executable, 'export const value = 2;');
  assert.notDeepEqual(snapshotInstalledPackage(root), before);
});

test('unknown initial process ownership cannot become a clean empty-tree result', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {windowsHide: true, stdio: 'ignore'});
  t.after(() => child.kill());
  const result = await observeHostProcess(child, {inspect: async () => {throw new Error('Injected ownership inspection failure.');}, refresh: async () => {}, stop: async () => {}, gone: async () => true, timeoutMs: 3000});
  assert.equal(result.ownershipInspectionFailed, true); assert.equal(result.ownedProcessesStopped, false);
  assert(child.exitCode !== null || child.signalCode !== null, 'The directly owned child must be stopped');
});
