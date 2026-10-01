import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve, join} from 'node:path';
import {mkdtempSync, rmSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {guardEvents} from '../scripts/lib/host-hooks.mjs';

function assertDenied(host, response) {
  if (host === 'claude') {assert.equal(response.status, 2); return;}
  assert.equal(response.status, 0);
  const output = JSON.parse(response.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'PreToolUse'); assert.equal(output.permissionDecision, 'deny');
  assert(output.permissionDecisionReason.length > 0);
}

test('Codex patch headers translate edits and moves, not patch body text', () => {
  const cwd = resolve('synthetic-consumer');
  const events = guardEvents('codex', {cwd, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_response: 'Success. Updated the following files:\nD utils/a.ts\nA utils/b.ts', tool_input: {command: '*** Begin Patch\n*** Update File: utils/a.ts\n+*** Delete File: not-a-header\n*** Move to: utils/b.ts\n*** End Patch'}});
  assert.deepEqual(events.map(e => e.input.tool_input.file_path), [resolve(cwd, 'utils/a.ts'), resolve(cwd, 'utils/b.ts')]);
});

test('Codex requires the actual applied file list, including for no-op responses', () => {
  const input = {cwd: process.cwd(), hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: {command: '*** Update File: utils/a.ts'}};
  for (const tool_response of [undefined, 'Success. Updated the following files:', 'Success. Updated the following files:\nM utils/other.ts', {isError: true, output: 'Success. Updated the following files:\nM utils/a.ts'}]) {
    assert.deepEqual(guardEvents('codex', {...input, tool_response}), []);
  }
});
test('unsupported and pre-edit events do not pretend an edit happened', () => {
  for (const host of ['claude', 'codex', 'unknown']) assert.deepEqual(guardEvents(host, {cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Edit'}), []);
  assert.deepEqual(guardEvents('claude', {}), []);
});
for (const host of ['claude', 'codex']) test(`${host}: stderr-only test failures preserve the retry guard`, t => {
  const cwd = mkdtempSync(join(tmpdir(), 'harness-m11-stderr-')); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const tool_input = {command: 'playwright test stderr.spec.ts'};
  const call = (hook_event_name, tool_response) => spawnSync(process.execPath, ['scripts/hooks/host.mjs', host], {
    encoding: 'utf8', input: JSON.stringify({cwd, session_id: 'synthetic', tool_name: 'Bash', hook_event_name, tool_input, tool_response})});
  assert.equal(call('PostToolUse', {stdout: '', stderr: 'Error: 1 test failed'}).status, 0);
  assertDenied(host, call('PreToolUse'));
});
for (const host of ['claude', 'codex']) test(`${host}: session, deny, failure ledger and behavior edit use consumer state`, t => {
  const cwd = mkdtempSync(join(tmpdir(), 'harness-m11-hook-')); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const call = (event, tool, extra = {}) => spawnSync(process.execPath, ['scripts/hooks/host.mjs', host], {encoding: 'utf8', input: JSON.stringify({cwd, session_id: 'synthetic', hook_event_name: event, tool_name: tool, ...extra})});
  assert.match(call('SessionStart').stdout, /skill-first/);
  assertDenied(host, call('PreToolUse', 'Bash', {tool_input: {command: 'git push origin main'}}));
  const command = 'playwright test synthetic.spec.ts';
  const response = host === 'codex' ? {tool_response: {content: [{type: 'text', text: '1 failed'}, {type: 'image', text: 'not output'}]}} : {error: '1 failed'};
  assert.equal(call(host === 'codex' ? 'PostToolUse' : 'PostToolUseFailure', 'Bash', {tool_input: {command}, ...response}).status, 0);
  assertDenied(host, call('PreToolUse', 'Bash', {tool_input: {command}}));
  if (host === 'codex') {
    call('PostToolUse', 'apply_patch', {tool_input: {command: '*** Begin Patch\n*** Add File: utils/Synthetic.ts\n+export {};\n*** End Patch'}, tool_response: 'Error: patch rejected'});
    assertDenied(host, call('PreToolUse', 'Bash', {tool_input: {command}}));
  }
  call('PostToolUse', host === 'codex' ? 'apply_patch' : 'Write', {tool_response: 'Success. Updated the following files:\nA utils/Synthetic.ts', tool_input: host === 'codex' ? {command: '*** Begin Patch\n*** Add File: utils/Synthetic.ts\n+export {};\n*** End Patch'} : {file_path: join(cwd, 'utils/Synthetic.ts')}});
  assert.equal(call('PreToolUse', 'Bash', {tool_input: {command}}).status, 0);
  const directory = join(cwd, '.harness/state/hooks'), files = readdirSync(directory); assert.equal(files.length, 1);
  const stored = readFileSync(join(directory, files[0]), 'utf8'); assert(!stored.includes(command)); assert(!stored.includes('synthetic.spec'));
});

test('Codex structured denial survives the real Windows PowerShell command boundary', {skip: process.platform !== 'win32'}, t => {
  const cwd = mkdtempSync(join(tmpdir(), 'harness-m11-shell-')); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = '& ' + [process.execPath, resolve('scripts/hooks/host.mjs'), 'codex'].map(quote).join(' ');
  const response = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 20000, input: JSON.stringify({cwd, session_id: 'synthetic', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {command: 'git push origin main'}})});
  assertDenied('codex', response);
});
