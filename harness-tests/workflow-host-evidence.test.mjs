import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve, join} from 'node:path';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {workflowInvocation, workflowReceipt, observedWorkflowCommand, observedWorkflowRead, observedWorkflowAuthorship, assessWorkflowHost} from '../scripts/lib/workflow-host-evidence.mjs';
const script = resolve('fixture-package/harness-tests/fixtures/workflow-command.mjs'), command = `node "${script}" complete`, sha256 = 'a'.repeat(64);
const receipt = {receipt: 'M15_WORKFLOW_RECEIPT', stage: 'complete', sha256, scenarios: 16}, expected = {stage: 'complete', sha256, scenarios: 16};
function events(host, text = JSON.stringify(receipt), nativeCommand = command) {
  return host === 'codex' ? [{type: 'turn.completed'}, {type: 'item.completed', item: {type: 'command_execution', status: 'completed', exit_code: 0, command: nativeCommand, aggregated_output: text}}]
    : [{type: 'result', is_error: false}, {type: 'assistant', message: {content: [{type: 'tool_use', id: 'native', name: 'Bash', input: {command: nativeCommand}}]}}, {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'native', content: text}]}}];
}
test('fixed workflow command recognition refuses echo and shell additions', () => {
  assert.equal(workflowInvocation(command, script), 'complete');
  assert.equal(workflowInvocation(`"C:/Runtime/pwsh.exe" -Command ${JSON.stringify(command)}`, script), 'complete');
  for (const text of [`echo '${command}'`, `${command}; echo done`, command.replace('complete', 'candidate && complete'), command.replace('workflow-command', 'other')]) assert.equal(workflowInvocation(text, script), null);
});

test('native cwd prefix must name exactly the authorized consumer and contain no additional operation', () => {
  const root = resolve('fixture consumer'), prefixed = `cd "${root}" && ${command}`;
  assert.equal(workflowInvocation(prefixed, script, root), 'complete');
  for (const text of [prefixed.replace(root, resolve('other')), `${prefixed} && echo done`, `cd "${root}" && echo done && ${command}`, `cd "${root}"; ${command}`]) assert.equal(workflowInvocation(text, script, root), null);
  assert.equal(workflowInvocation(prefixed, script), null);
});

test('Git Bash drive spelling is equivalent only on Windows and never authorizes another drive', () => {
  const nativeScript = 'C:/fixture package/workflow-command.mjs', root = 'C:/fixture consumer';
  assert.equal(workflowInvocation(`cd "/c/fixture consumer" && node "/c/fixture package/workflow-command.mjs" complete`, nativeScript, root), process.platform === 'win32' ? 'complete' : null);
  assert.equal(workflowInvocation(`cd "/d/fixture consumer" && node "${nativeScript}" complete`, nativeScript, root), null);
  assert.equal(workflowInvocation(`cd "/c/fixture consumer" && node "${nativeScript}" complete && echo done`, nativeScript, root), null);
});
test('receipt extraction rejects empty, duplicated and ambiguous scope', () => {
  assert.deepEqual(workflowReceipt(JSON.stringify(receipt)), expected);
  for (const text of ['', JSON.stringify({...receipt, scenarios: 0}), JSON.stringify(receipt) + JSON.stringify(receipt)]) assert.equal(workflowReceipt(text), null);
});

test('Claude whole-source shell read must name this file and return its complete bytes', () => {
  const root = resolve('fixture consumer'), path = resolve(root, 'source.json'), content = '{"id":"source","scenarios":[1,2]}';
  const actual = events('claude', content, `cat "${path}"`);
  assert.equal(observedWorkflowRead('claude', actual, path, root, content), true);
  for (const command of [`cat "${resolve(root, 'other.json')}"`, `echo '${content}'`, `cat "${path}"; echo done`, `cat "${path}" | head -1`]) {
    assert.equal(observedWorkflowRead('claude', events('claude', content, command), path, root, content), false);
  }
  assert.equal(observedWorkflowRead('claude', events('claude', content.slice(0, -1), `cat "${path}"`), path, root, content), false);
  actual.at(-1).message.content[0].is_error = true;
  assert.equal(observedWorkflowRead('claude', actual, path, root, content), false);
});

test('Claude cannot substitute unpaired source text for a native read', () => {
  const root = resolve('fixture consumer'), path = resolve(root, 'source.json'), content = '{"source":1}';
  const actual = events('claude', content, `cat "${path}"`); actual.at(-1).message.content[0].tool_use_id = 'different';
  assert.equal(observedWorkflowRead('claude', actual, path, root, content), false);
  assert.equal(observedWorkflowRead('claude', [{type: 'assistant', message: {content: [{type: 'text', text: content}]}}], path, root, content), false);
});

test('a foreign UNC source is never the local source even when returned bytes are identical', () => {
  const root = resolve('proof-share/consumer'), path = join(root, 'source.json'), content = '{"source":1}';
  const foreign = '//' + path.replace(/^[a-z]:[\\/]|^\/+/i, '').replaceAll('\\', '/');
  for (const host of ['claude', 'codex']) {
    assert.equal(observedWorkflowRead(host, events(host, content, `cat "${path}"`), path, root, content), true);
    assert.equal(observedWorkflowRead(host, events(host, content, `cat "${foreign}"`), path, root, content), false);
  }
});

test('native Read pairs complete numbered content with the exact owned file', () => {
  const root = resolve('fixture consumer'), path = join(root, 'source.json'), content = '{\n"source":1\n}';
  const actual = events('claude', '1→{\n2→"source":1\n3→}\n<system-reminder>native reminder</system-reminder>');
  const call = actual[1].message.content[0]; call.name = 'Read'; call.input = {file_path: path};
  assert.equal(observedWorkflowRead('claude', actual, path, root, content), true);
  call.input.file_path = resolve('other consumer/source.json');
  assert.equal(observedWorkflowRead('claude', actual, path, root, content), false);
});

test('a consumer skill link resolves to the canonical package content', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'm15-native-read-'));
  try {
    const root = join(temporaryRoot, 'consumer'), library = join(temporaryRoot, 'package/skills'), content = '# Actual canonical skill';
    mkdirSync(root); mkdirSync(library, {recursive: true}); writeFileSync(join(library, 'SKILL.md'), content);
    symlinkSync(library, join(root, 'skills'), 'junction');
    for (const host of ['claude', 'codex']) assert.equal(observedWorkflowRead(host, events(host, content, 'cat "skills/SKILL.md"'), join(library, 'SKILL.md'), root, content), true);
  } finally {
    assert.ok(temporaryRoot.startsWith(join(tmpdir(), 'm15-native-read-')));
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
});

test('a foreign UNC authored-file event cannot establish local consumer authorship', () => {
  const root = resolve('proof-share/consumer'), path = 'src/pages/ObservationPage.ts', actual = join(root, path);
  const foreign = '//' + actual.replace(/^[a-z]:[\\/]|^\/+/i, '').replaceAll('\\', '/');
  for (const host of ['claude', 'codex']) {
    const writes = value => host === 'claude' ? [{type: 'assistant', message: {content: [{type: 'tool_use', id: 'write', name: 'Write', input: {file_path: value}}]}}, {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'write', is_error: false}]}}]
      : [{type: 'item.completed', item: {type: 'file_change', status: 'completed', changes: [{path: value}]}}];
    assert.equal(observedWorkflowAuthorship(host, writes(actual), root, path), true);
    assert.equal(observedWorkflowAuthorship(host, writes(foreign), root, path), false);
  }
});
for (const host of ['claude', 'codex']) {
  test(`${host} whole-file reads reject another consumer, shell additions and incomplete results`, () => {
    const root = resolve('fixture consumer'), path = join(root, 'source.json'), content = '{"source":[1,2]}';
    for (const body of [`cat "${path}"`, 'cat source.json', `Get-Content -Raw -LiteralPath "${path}"`, `cd "${root}" && cat "${path}"`, `"C:/Runtime/pwsh.exe" -Command ${JSON.stringify(`Get-Content -Raw -LiteralPath "${path}"`)}`]) {
      assert.equal(observedWorkflowRead(host, events(host, content, body), path, root, content), true, body);
    }
    for (const body of [`cat "${resolve('other consumer/source.json')}"`, `echo '${content}'`, `cat "${path}" | head -1`, `cat "${path}"; cat other.json`, `cd "${resolve('other consumer')}" && cat source.json`]) {
      assert.equal(observedWorkflowRead(host, events(host, content, body), path, root, content), false, body);
    }
    assert.equal(observedWorkflowRead(host, events(host, content.slice(0, -1), `cat "${path}"`), path, root, content), false);
    const failed = events(host, content, `cat "${path}"`);
    if (host === 'codex') failed[1].item.exit_code = 1; else failed[2].message.content[0].is_error = true;
    assert.equal(observedWorkflowRead(host, failed, path, root, content), false);
  });
  test(`${host} binds a native cwd-prefixed receipt to this consumer`, () => {
    const projectRoot = resolve('fixture consumer'), native = events(host, JSON.stringify(receipt), `cd "${projectRoot}" && ${command}`);
    assert.equal(observedWorkflowCommand(host, native, script, 'complete', expected, projectRoot), true);
    assert.equal(observedWorkflowCommand(host, native, script, 'complete', expected, resolve('other')), false);
  });
  test(`${host} needs a paired successful native command with the exact artifact receipt`, () => {
    assert.equal(observedWorkflowCommand(host, events(host), script, 'complete', expected), true);
    assert.equal(observedWorkflowCommand(host, events(host), script, 'complete', {...expected, sha256: 'b'.repeat(64)}), false);
    assert.equal(observedWorkflowCommand(host, events(host), script, 'complete', {...expected, scenarios: 1}), false);
  });
  test(`${host} cannot substitute final prose for actual workflow execution`, () => {
    assert.equal(observedWorkflowCommand(host, [{type: 'assistant', message: {content: [{type: 'text', text: JSON.stringify(receipt)}]}}], script, 'complete', expected), false);
  });
  test(`${host} unknown process ownership and package changes invalidate native completion`, () => {
    const base = {host, roots: {packageRoot: resolve('fixture-package')}, events: events(host), commands: [{...expected, command: 'complete'}], processResult: {exitCode: 0, timedOut: false, ownedProcessesStopped: true, packageUnchanged: true}};
    assert.equal(assessWorkflowHost(base).status, 'PASS');
    for (const field of ['ownedProcessesStopped', 'packageUnchanged']) assert.equal(assessWorkflowHost({...base, processResult: {...base.processResult, [field]: false}}).status, 'FAIL');
  });
}
