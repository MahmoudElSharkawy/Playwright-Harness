import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, symlinkSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {commandFixture} from './fixtures/execute-commands.mjs';
import {diagnosticDelta, redact} from '../scripts/lib/execute/commands.mjs';
import {NativeRefusal} from '../scripts/lib/browser/native-cli.mjs';
import {commitFile, readOptional, publishExclusive, readBounded} from '../scripts/lib/execute/storage.mjs';
import {HostMailbox, sendCommand} from '../scripts/lib/execute/mailbox.mjs';
import {loginBindings} from '../scripts/lib/execute/host.mjs';
import {markdownText} from '../scripts/lib/execute/report.mjs';
import {draftMetadata, allowedFieldValue, acknowledgedId} from '../scripts/lib/execute/delivery.mjs';
import {mandatoryLiterals} from '../scripts/lib/execute/verdicts.mjs';
import {parameterNames} from '../scripts/lib/integrations/ado-steps.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';

function directory(t) {const path = mkdtempSync(join(realpathSync(tmpdir()), 'harness-remediation-')); t.after(() => rmSync(path, {recursive: true, force: true, maxRetries: 20, retryDelay: 100})); return path;}

test('B2: pinned history aliases dispatch; malformed syntax and native snapshot make zero calls', async t => {
  const f = commandFixture(directory(t)); await f.commands.snapshot(); f.calls.length = 0;
  for (const args of [['click', 'e1', 'garbage'], ['resize', 'potato', '-1'], ['tab-select', 'banana'], ['type', 'e2', 'text'], ['snapshot'], ['find'], ['find', '--regex', '['], ['find', '--regex', '/a/z'], ['find', 'Save', '--regex', 'Save'], ['click', 'e1', '--modifiers', 'Banana']]) await assert.rejects(f.commands.dispatch(['native', ...args]), /REFUSED/);
  assert.equal(f.calls.length, 0); assert.equal(f.commands.ledger.poisoned, false);
  await f.commands.native(['back']); await f.commands.native(['forward']);
  assert.deepEqual(f.calls.filter(row => row[0] === 'native').map(row => row[1]), ['go-back', 'go-forward']);
  await f.commands.native(['find', '--regex', '/save/gi']);
});

test('B3: modal refusal allows dismissal, invalidates refs and preserves an earlier FAIL', async t => {
  const f = commandFixture(directory(t), {disabled: false}); await f.commands.check('k1', 1, {read: 'state e1'});
  await f.commands.native(['click', 'e1']); const native = f.context.native; let modal = true;
  f.context.native = async args => {if (args[0] === 'snapshot' && modal) throw new NativeRefusal('MODAL_PENDING'); if (args[0] === 'dialog-dismiss') modal = false; return native(args);};
  await assert.rejects(f.commands.snapshot(), error => error.reason === 'MODAL_PENDING'); assert.equal(f.commands.ledger.poisoned, false);
  await f.commands.native(['dialog-dismiss']); assert.throws(() => f.commands.ref('e1'), /NOT_IN_SNAPSHOT/);
  await f.commands.snapshot(); await f.commands.finalize('confirmed'); assert.equal(f.assertions[0].status, 'FAIL');
});

test('B4: exception stacks and reset request numbering are diagnostic deltas', () => {
  const state = {console: 0, requests: new Set()};
  const first = diagnosticDelta('console', {result: 'Uncaught TypeError: broken\n    at action (app.js:2:1)\n'}, state); assert.equal(first.entries.length, 1); assert.match(first.entries[0].detail, /at action/);
  assert.equal(diagnosticDelta('console', {result: 'Uncaught TypeError: broken\n    at action (app.js:2:1)\n'}, state).entries.length, 0);
  const interleaved = diagnosticDelta('console', {result: '[ERROR] New console failure\nUncaught TypeError: broken\n    at action (app.js:2:1)\n'}, state);
  assert.equal(interleaved.entries.length, 1); assert.match(interleaved.entries[0].detail, /New console failure/);
  diagnosticDelta('requests', {result: '99. [GET] https://app.test/old => [500]'}, state);
  assert.equal(diagnosticDelta('requests', {result: '1. [GET] https://app.test/new?private=x => [500]'}, state).entries[0].path, '/new');
  assert.equal(diagnosticDelta('console', {result: '[ERROR] Second page failure'}, state).entries.length, 1);
  assert.equal(diagnosticDelta('console', {result: '[ERROR] Third page failure\n[ERROR] Another third page failure'}, state).entries.length, 2);
  assert.equal(diagnosticDelta('console', {result: '[ERROR] Third page failure\n[ERROR] Another third page failure'}, state).entries.length, 0);
});

test('B3 F6: modal screenshot refusal allows dismissal and verification without poisoning', async t => {
  const f = commandFixture(directory(t)), native = f.context.native;
  f.context.native = async args => {if (args[0] === 'screenshot') throw new NativeRefusal('MODAL_PENDING'); return native(args);};
  await assert.rejects(f.commands.screenshot(), error => error.reason === 'MODAL_PENDING');
  assert.equal(f.commands.ledger.poisoned, false); await f.commands.native(['dialog-dismiss']); await f.commands.snapshot();
  assert.equal((await f.commands.check('k1', 1, {read: 'state e1'})).status, 'PASS');
});

test('D2: planted login-state directory link and escaped destination are refused before native dispatch', async t => {
  const root = directory(t), outside = directory(t), f = commandFixture(root); f.step.login = {user: 'tester', landmark: 'Save'}; f.step.target = 'ui';
  mkdirSync(join(root, '.harness/runs/exec1'), {recursive: true}); const link = join(root, '.harness/runs/exec1/auth');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); await f.commands.snapshot(); const count = f.calls.length;
  await assert.rejects(f.commands.dispatch(['save-login']), /link|escape|owned|outside/i); assert.equal(f.calls.length, count); assert.equal(readdirSync(outside).length, 0);
  unlinkSync(link); f.step.target = '../escape'; await assert.rejects(f.commands.dispatch(['save-login']), /Invalid execution file/); assert.equal(f.calls.length, count);
});

test('B5: short public usernames stay outside secret bindings; conflicting aliases are refused', () => {
  const scenario = {steps: [{target: 'ui', login: {user: 'tester'}}]}, environment = {targets: {browser: {ui: {users: {tester: {usernameRef: 'env:USER', passwordRef: 'env:PASS'}}}}}};
  const result = loginBindings(scenario, environment, {USER: 'e1', PASS: 'fixture-private-value'});
  assert.deepEqual(Object.keys(result.secrets), ['HARNESS_PASSWORD_TESTER']); assert.equal(result.usernames.HARNESS_USERNAME_TESTER, 'e1');
  assert.equal(redact('https://app.test/users/e1 [ref=e1]', Object.values(result.secrets)), 'https://app.test/users/e1 [ref=e1]');
  environment.targets.browser.other = {users: {tester: {usernameRef: 'env:OTHER', passwordRef: 'env:PASS'}}}; scenario.steps.push({target: 'other', login: {user: 'tester'}});
  assert.throws(() => loginBindings(scenario, environment, {USER: 'e1', OTHER: 'different', PASS: 'fixture-private-value'}), /conflicting/);
});

test('V5: mismatch polling retains only decisive evidence and remains cancellable', async t => {
  const f = commandFixture(directory(t), {disabled: false}); setTimeout(() => f.disabled(true), 300);
  const result = await f.commands.check('k1', 1, {read: 'state e1', wait: '1500'});
  assert.equal(result.status, 'PASS'); assert.equal(f.evidence.size, 2); assert(f.calls.filter(row => row[1] === 'eval').length >= 2);
  const saved = [...f.evidence.values()].find(item => item.kind === 'observation').value; assert(saved.polling.samples >= 2);
  f.disabled(false); f.commands.cancelled = () => true; const calls = f.calls.length;
  await assert.rejects(f.commands.check('k1', 1, {read: 'state e1', wait: '1000'}), /STOP_REQUESTED/); assert.equal(f.calls.length, calls);
});

test('H5 D1: oversized snapshots and native redaction damage invalidate references explicitly', async t => {
  const f = commandFixture(directory(t)); await f.commands.snapshot(); f.snapshot('x'.repeat(250 * 1024));
  await assert.rejects(f.commands.snapshot(), /SNAPSHOT_TOO_LARGE/); assert.throws(() => f.commands.ref('e1'), /NOT_IN_SNAPSHOT/);
  for (const damaged of ['- button "Save" [ref=<secret>]', '- text<secret> "Name" [ref=e2]', '- textbox "Name" [<secret>=e2]', '- textbox "Name" [r[redacted]=e2]']) {f.snapshot(damaged); await assert.rejects(f.commands.snapshot(), /NATIVE_SECRET_COLLISION/);}
  f.snapshot('- button "Save" [ref=e1]'); f.commands.privateValues = ['e1']; await assert.rejects(f.commands.snapshot(), /NATIVE_SECRET_COLLISION/);
});

test('D1: bounded sensitive JSON and form leaves redact encoded variants', () => {
  const privateValue = 'private / leaf', values = [JSON.stringify({outer: {value: privateValue}}), 'credential=second%20leaf'];
  assert.deepEqual(redact({text: `${privateValue} ${encodeURIComponent(privateValue)} second+leaf`}, values), {text: '[redacted] [redacted] [redacted]'});
});

test('H5: token-like snapshot lines and their descendants cannot become reportable subjects', async t => {
  const f = commandFixture(directory(t)), synthetic = 'gh' + 'p_' + 'x'.repeat(32);
  f.snapshot(`- button "${synthetic}" [ref=e1]\n  - textbox "Child" [ref=e2]\n- button "Public" [ref=e3]`);
  const result = await f.commands.snapshot();
  assert(!result.text.includes(synthetic)); assert.throws(() => f.commands.ref('e1'), /NOT_IN_SNAPSHOT/); assert.throws(() => f.commands.ref('e2'), /NOT_IN_SNAPSHOT/); assert.equal(f.commands.ref('e3').name, 'Public');
});

for (const expected of ['42', '10.00']) test(`V4: explicit ${expected} keeps the frozen string type`, async t => {
  const f = commandFixture(directory(t), {predicate: 'equals', expected: {source: 'source-text', value: expected}});
  f.step.contracts[0].condition.text = `Name equals ${expected}`; f.value(expected);
  assert.equal((await f.commands.check('k1', 1, {read: 'value e2', value: expected, exact: true})).status, 'PASS');
});

test('L1 L3: read/remove races and Windows publication contention have bounded retries', () => {
  assert.equal(readOptional('unused', 100, {read() {throw Object.assign(new Error(), {code: 'ENOENT'});}}), null);
  let time = 0, reads = 0;
  assert.deepEqual(readOptional('unused', 100, {read() {if (++reads < 3) throw Object.assign(new Error(), {code: 'EBUSY'}); return {ok: true};}, now: () => time, pause: ms => {time += ms;}}), {ok: true});
  time = 0; let commits = 0;
  commitFile('temp', 'file', {platform: 'win32', now: () => time, pause: ms => {time += ms;}, rename() {commits++; if (time < 600) throw Object.assign(new Error(), {code: 'EPERM'});}});
  assert(time >= 600 && time <= 2000); assert(commits > 2);
  time = 0; assert.throws(() => commitFile('temp', 'file', {platform: 'win32', now: () => time, pause: ms => {time += ms;}, rename() {throw Object.assign(new Error('permanent'), {code: 'EACCES'});}}), /permanent/); assert.equal(time, 2000);
});

test('L4 U6: canonical receipt survives a sequence-link crash and consumed inbox files are removed', async t => {
  const root = directory(t), box = new HostMailbox(root, 'run1', 'channel'), requestId = randomUUID(), request = {seq: 1, requestId, runId: 'run1', channel: 'channel', args: ['native', 'click', 'e1']};
  publishExclusive(join(root, 'inbox/1.json'), JSON.stringify(request)); const taken = box.take();
  const save = box.save.bind(box); box.save = () => {throw new Error('Injected crash after canonical publication');};
  assert.throws(() => box.reply(taken, {status: 'OK', dispatched: true}), /Injected crash/);
  assert.equal(box.state.nextSeq, 1); assert.equal((await sendCommand(root, 'run1', request.args, {requestId})).dispatched, true);
  box.save = save; assert.equal(box.take().cached.dispatched, true); box.reply(taken, {status: 'OK', dispatched: true});
  assert.equal(box.state.nextSeq, 2); assert.equal(readdirSync(join(root, 'inbox')).length, 0);
  const result = await sendCommand(root, 'run1', request.args, {requestId}); assert.equal(result.dispatched, true);
  assert.equal(readBounded(join(root, 'replies', `id-${requestId}.json`)).requestId, requestId);
  await assert.rejects(sendCommand(join(root, 'missing'), 'run1', ['look'], {requestId}), error => error.requestId === requestId);
});

test('H3 L4: terminal host without a receipt explicitly reports an uncertain command without replay', async t => {
  const root = directory(t), box = new HostMailbox(root, 'run1', 'channel'), requestId = randomUUID();
  publishExclusive(join(root, 'inbox/1.json'), JSON.stringify({seq: 1, requestId, runId: 'run1', channel: 'channel', args: ['native', 'click', 'e1']}));
  box.take(); box.save({state: 'INTERRUPTED'});
  const reply = await sendCommand(root, 'run1', ['native', 'click', 'e1'], {requestId, timeoutMs: 100});
  assert.equal(reply.status, 'COMMAND_UNCERTAIN'); assert.equal(reply.seq, 1); assert.equal(reply.requestId, requestId); assert.equal(box.state.nextSeq, 1);
  const awaited = await sendCommand(root, 'run1', [], {awaitSeq: 1, timeoutMs: 100}); assert.equal(awaited.status, 'COMMAND_UNCERTAIN'); assert.equal(awaited.requestId, requestId);
});

test('S2 C8: shared parameter quotes and literal apostrophes keep their intended meaning', () => {
  assert.deepEqual(parameterNames('<parameters><param name="City"/><param name=\'Country\'/></parameters>'), ['City', 'Country']);
  assert.deepEqual(mandatoryLiterals({text: "User's balance isn't 'negative'"}), ['negative']);
});

test('U1: automation exploration and generation reference the current handoff, not removed legacy notes', () => {
  const playbook = readFileSync(join(packageRoot, '.agents/skills/automate-suite/references/playbook.md'), 'utf8'), map = readFileSync(join(packageRoot, '.agents/skills/automate-suite/references/page-map.md'), 'utf8');
  assert(!playbook.includes('codegen-notes/')); assert(!playbook.includes('preflight.js')); assert.match(playbook, /M13 generation handoff/); assert.match(map, /M13/);
});

test('D4 D6 D7: generated Markdown and ADO metadata stay bounded and typed', () => {
  assert.equal(markdownText('A|B\n# heading'), 'A\\|B \\# heading');
  assert.equal(draftMetadata({}, 'fp', {}, 'x'.repeat(300)).title.length, 255);
  assert.throws(() => draftMetadata({fp: {title: 'x'.repeat(256)}}, 'fp', {}, 'short'), /fp/);
  assert.equal(allowedFieldValue({type: 'integer', allowedValues: ['2']}, 2), true);
  assert.equal(allowedFieldValue({type: 'integer', allowedValues: ['2']}, '2garbage'), false);
  assert.equal(allowedFieldValue({type: 'identity', allowedValues: [{uniqueName: 'user@example.test'}]}, 'user@example.test'), true);
});

test('D8: recovered acknowledgement must match operation and exact request fingerprint', t => {
  const root = directory(t), receipt = `.harness/state/integrations/${randomUUID()}.jsonl`, path = join(root, receipt); mkdirSync(join(root, '.harness/state/integrations'), {recursive: true});
  writeFileSync(path, ['one', 'two'].map((requestFingerprint, index) => JSON.stringify({event: 'acknowledged', operation: 'upload-attachment', requestFingerprint, identity: {attachmentId: `attachment-${index}`}})).join('\n'));
  assert.equal(acknowledgedId({projectRoot: root}, receipt, 'upload-attachment', 'attachmentId', 'one'), 'attachment-0');
  assert.equal(acknowledgedId({projectRoot: root}, receipt, 'upload-attachment', 'attachmentId', 'unknown'), undefined);
  assert.equal(acknowledgedId({projectRoot: root}, receipt, 'create-bug', 'attachmentId', 'one'), undefined);
});
