#!/usr/bin/env node
// A fixed driver exercises the same mailbox protocol used by a live agent.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {within} from '../lib/skill-roots.mjs';
import {protect} from '../lib/generation/storage.mjs';
import {prepareSource} from '../lib/execute/source.mjs';
import {draftRefinement, freezeExecution} from '../lib/execute/refinement.mjs';
import {createExecution, ownedFile, readBounded, writeJson} from '../lib/execute/storage.mjs';
import {loadEnvironment} from '../lib/project-config.mjs';
import {executeMain} from '../execute-test.mjs';
import {collectExecution, writeExecutionReport} from '../lib/execute/report.mjs';
import {lockStatus} from '../lib/execute/lock.mjs';
import {delay} from '../lib/execute/mailbox.mjs';
import {processInventory} from '../lib/browser/processes.mjs';
import {completeExecuteChecks, retryProbeDiagnostic} from './execute-checks.mjs';
import {proofSignal} from './cancellation.mjs';
import {snapshotRefs} from '../lib/browser/snapshot.mjs';

assert.equal(process.argv.length, 3, 'Use one new external consumer directory.');
const projectRoot = resolve(process.argv[2]); assert(!within(packageRoot, projectRoot));
mkdirSync(projectRoot, {mode: 0o700}); protect(projectRoot);
const roots = consumerRoots(projectRoot, packageRoot), checks = [], latency = {}, exec = promisify(execFile);
const username = `fixture-user-${randomUUID()}`, credential = randomUUID(), session = randomUUID();
const counts = {logins: 0, records: 0}, hosts = new Set(); let unavailable = false, fixtureServersClosed = false;
const html = signed => `<!doctype html><html><head><title>Execution fixture</title></head><body>
<h1>${signed ? 'Signed in' : 'Execution fixture'}</h1>
${signed ? '' : '<label>Username<input id="user"></label><label>Password<input id="password" type="password"></label><button id="login">Sign in</button>'}
<fieldset disabled><button id="save">Save</button></fieldset><label>Status<input id="status" value="Bad" readonly></label><button id="good">Make good</button>
<button id="async">Start update</button><p id="async-status">Waiting</p><div role="region" aria-label="Panel" style="background:blue;color:white;padding:16px">Panel<input aria-label="Panel text"><input type="checkbox" aria-label="Panel choice"><input type="hidden" value="Ignored"></div>
<button id="new">New record</button><div id="record"></div>
<button>Order #1001</button><button>Status: Active</button><iframe title="Same origin" src="/frame"></iframe>
<button onclick="confirm('Fixture confirmation')">Open dialog</button>
<label>Long status<textarea readonly>${'x'.repeat(100 * 1024)}</textarea></label>
<script>
const login=document.querySelector('#login');if(login)login.onclick=async()=>{const response=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.querySelector('#user').value,password:document.querySelector('#password').value})});if(response.ok)location.href='/account';};
document.querySelector('#good').onclick=()=>document.querySelector('#status').value='Good';
document.querySelector('#async').onclick=()=>{document.querySelector('#async-status').textContent='Ready';setTimeout(()=>document.querySelector('#async-status').textContent='Changed',10000);};
document.querySelector('#new').onclick=async()=>{await fetch('/record',{method:'POST'});document.querySelector('#record').innerHTML='<h2>record-created</h2><button id="delete">Delete record-created</button>';document.querySelector('#delete').onclick=async()=>{await fetch('/record',{method:'DELETE'});document.querySelector('#record').textContent='';};};
console.error('Synthetic diagnostic');fetch('/diagnostic?privateQuery=omitted');
</script></body></html>`;
const server = createServer(async (request, response) => {
  if (request.url === '/read-fixture') {response.writeHead(200, {'content-type': 'text/html'}); response.end(`<!doctype html><body><p>Sh<span>own</span></p><p hidden>Hidden secret</p><div style="visibility:hidden">Hidden parent<span style="visibility:visible">Visible child</span></div><div contenteditable role="textbox" aria-label="Notes">Saved note</div><input value="Editable echo"><button aria-label="Accessible only"></button><select aria-label="Country"><option value="US" selected>United States</option><option>Unselected label</option></select><div id="shadow"><span slot="label">Assigned label</span>Hidden light</div><iframe srcdoc="<p>Frame text</p>"></iframe><iframe sandbox srcdoc="<p>Unavailable content</p>"></iframe><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<p>Shadow text</p><slot name="label">Fallback</slot>';</script></body>`); return;}
  if (request.url === '/frame') {response.writeHead(200, {'content-type': 'text/html'}); response.end('<button>Frame action</button>'); return;}
  if (unavailable) {request.socket.destroy(); return;}
  if (request.url.startsWith('/diagnostic')) {response.writeHead(500); response.end('Synthetic failure'); return;}
  if (request.url === '/login' && request.method === 'POST') {
    let bytes = ''; for await (const chunk of request) bytes += chunk;
    const input = JSON.parse(bytes); if (input.username !== username || input.password !== credential) {response.writeHead(401); response.end(); return;}
    counts.logins++; response.writeHead(200, {'set-cookie': `harnessFixture=${session}; Path=/; HttpOnly; SameSite=Lax`}); response.end('ok'); return;
  }
  if (request.url === '/record') {counts.records += request.method === 'POST' ? 1 : request.method === 'DELETE' ? -1 : 0; response.writeHead(200); response.end('ok'); return;}
  response.writeHead(200, {'content-type': 'text/html'}); response.end(html(request.headers.cookie?.includes(session)));
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
writeJson(join(projectRoot, '.harness/project.json'), {version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: [], databaseTargets: [], browserTargets: ['ui']}}});
writeJson(join(projectRoot, '.harness/targets.json'), {api: {}, databases: {}, browser: {ui: {origins: [origin], startUrl: origin, users: {tester: {usernameRef: 'env:EXECUTE_PROBE_USER', passwordRef: 'env:EXECUTE_PROBE_PASSWORD'}}}}});
process.env.EXECUTE_PROBE_USER = username; process.env.EXECUTE_PROBE_PASSWORD = credential;
const condition = (text, predicate = 'present', expected, subject = 'page') => ({text, predicate, subject, expected: expected === undefined ? null : {source: 'source-text', value: expected}, precondition: false, exact: false, ambiguous: false});
const fixture = (texts, {diagnostics = 'end', cases = 1, mutate} = {}) => {
  const source = prepareSource({organizationUrl: 'https://ado.example.test', project: 'Synthetic', suiteName: 'Execute proof', cases: Array.from({length: cases}, (_, index) => ({id: 101 + index, rev: 1, title: `Synthetic ${index + 1}`, parameters: null, steps: texts.map(expected => ({action: 'Observe the synthetic fixture', expected}))}))}, {kind: 'suite', planId: 1, suiteId: 2});
  const refinement = draftRefinement(source, loadEnvironment(roots)); refinement.limits = {timeoutMs: 180000, cleanupTimeoutMs: 60000};
  for (const scenario of refinement.scenarios) for (const step of scenario.steps) {step.capability = 'reads'; step.readOnlyContract = {reason: 'Synthetic observations have no business effect.'}; step.expectations[0].conditions = [condition(step.expectations[0].conditions[0].text, 'present', 'Execution fixture')];}
  mutate?.(refinement);
  const {executionId} = createExecution(roots, source, refinement, {diagnostics}); freezeExecution(roots, executionId);
  return {executionId, refinement, runId: null};
};
async function next(f, extra = []) {
  proofSignal.throwIfAborted();
  const {stdout} = await exec(process.execPath, [join(packageRoot, 'scripts/execute-test.mjs'), '--project-root', projectRoot, 'next', f.executionId, ...extra], {windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024});
  const result = JSON.parse(stdout); assert.equal(result.status, 'READY'); f.runId = result.runId;
  const status = await executeMain(roots, ['status', f.executionId]); hosts.add(status.host.pid); return result;
}
async function doCommand(f, ...args) {
  proofSignal.throwIfAborted(); const result = await executeMain(roots, ['do', f.executionId, ...args]);
  assert(!['ERROR', 'BUSY', 'REPLY_PENDING'].includes(result.status), `${args[0]}: ${result.reason ?? result.status}`); return result;
}
async function look(f) {return doCommand(f, 'look');}
const reference = (snapshot, role, name) => {
  const found = [...snapshotRefs(snapshot)].find(([, subject]) => subject.role === role && subject.name === name);
  assert(found, `No ${role} named ${name} in the snapshot.`); return found[0];
};
async function click(f, name) {const seen = await look(f); return doCommand(f, 'native', 'click', reference(seen.snapshot, 'button', name));}
async function checkPage(f, key, index = 1, wait) {return doCommand(f, 'check', key, '--condition', String(index), '--read', 'page', ...(wait ? ['--wait', String(wait)] : []));}
async function ending(f, effect = 'none') {return doCommand(f, 'end-step', '--effect', effect);}
async function awaitStatus(f, test, timeout = 90000, observe = () => {}) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {const result = await executeMain(roots, ['status', f.executionId]); observe(result.host); if (test(result.host)) return result.host; await delay(100);}
  throw new Error('Host did not reach its expected state.');
}
async function finish(f, expected = 'PASS') {
  await awaitStatus(f, state => ['FINISHED', 'INTEGRITY_FAILURE', 'INTERRUPTED'].includes(state.state));
  const view = collectExecution(roots, f.executionId), selected = view.scenarios.find(scenario => scenario.history.some(run => run.runId === f.runId)); assert.equal(selected.status, expected);
  assert(view.runs.filter(row => row.state === 'ASSESSED').every(row => row.result.scenarios[0].requiredLifecycleComplete)); return view;
}
async function check(name, action) {
  let diagnostic = {};
  const mark = (stage, facts = {}) => {diagnostic = {stage, ...facts};};
  try {proofSignal.throwIfAborted(); const facts = await action(mark); checks.push({name, status: 'PASS', facts});}
  catch (error) {const facts = retryProbeDiagnostic({...diagnostic, actual: error.actual}); checks.push({name, status: 'FAIL', message: error.message, ...(facts ? {diagnostic: facts} : {})});}
  unavailable = false; console.log(JSON.stringify(checks.at(-1)));
  const owner = await lockStatus(roots);
  if (owner) try {await executeMain(roots, ['stop', owner.executionId]); await awaitStatus({executionId: owner.executionId}, state => ['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(state.state));} catch { /* Recovery below proves ownership before stopping leftovers. */ }
}
let login;
try {
  await check('snapshot-refs', async () => {
    const f = fixture(['Execution fixture is present.'], {mutate: refinement => {const step = refinement.scenarios[0].steps[0]; step.capability = 'mutations'; delete step.readOnlyContract;}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001');
    for (const path of ['/', '/second']) {
      await doCommand(f, 'native', 'goto', `${origin}${path}`);
      for (const name of ['Order #1001', 'Status: Active', 'Frame action']) await click(f, name);
    }
    await doCommand(f, 'native', 'reload'); const seen = await look(f);
    assert.match(reference(seen.snapshot, 'button', 'Save'), /^f\d+e\d+$/);
    await checkPage(f, begun.contracts[0].key); await ending(f, 'confirmed'); await finish(f);
    return {navigations: 2, iframe: true, reload: true};
  });
  await check('rendered-reads', async () => {
    const f = fixture(['"United States" is present. "Hidden secret" is absent.'], {mutate: refinement => {refinement.scenarios[0].steps[0].expectations[0].conditions = [condition('"United States" is present.', 'present', 'United States'), condition('"Hidden secret" is absent.', 'absent', 'Hidden secret')];}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', `${origin}/read-fixture`);
    const present = await checkPage(f, begun.contracts[0].key); assert.equal(present.result.status, 'PASS');
    const text = present.result.read.excerpt; for (const value of ['Shown', 'United States', 'Shadow text', 'Assigned label', 'Frame text', 'Visible child']) assert(text.includes(value));
    for (const value of ['Hidden secret', 'Editable echo', 'Unselected label', 'Accessible only', 'Hidden light', 'Fallback', 'Hidden parent', 'Saved note']) assert(!text.includes(value));
    assert.equal(text.split('Assigned label').length, 2); assert.equal(present.result.read.coverage.complete, false);
    const seen = await look(f), editor = await doCommand(f, 'capture', 'editorText', '--read', `text ${reference(seen.snapshot, 'textbox', 'Notes')}`); assert.equal(editor.output.value, 'Saved note');
    assert.equal((await checkPage(f, begun.contracts[0].key, 2)).result.status, 'INDETERMINATE'); await ending(f); await finish(f, 'NEEDS_REVIEW');
    return {renderedText: true, selectedLabel: true, shadowAndSlotOnce: true, frameGap: true};
  });
  await check('modal-and-type', async () => {
    const f = fixture(['Execution fixture is present.'], {mutate: refinement => {const step = refinement.scenarios[0].steps[0]; step.capability = 'mutations'; delete step.readOnlyContract;}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', origin);
    let seen = await look(f); await doCommand(f, 'native', 'click', reference(seen.snapshot, 'textbox', 'Username')); await look(f); await doCommand(f, 'native', 'type', 'Synthetic public name');
    await click(f, 'Open dialog'); const refused = await executeMain(roots, ['do', f.executionId, 'look']); assert.equal(refused.status, 'MODAL_PENDING');
    await doCommand(f, 'native', 'dialog-dismiss'); await look(f); await checkPage(f, begun.contracts[0].key); await ending(f, 'confirmed'); await finish(f);
    return {focusedType: true, modalRecovery: true};
  });
  await check('login-reuse', async () => {
    login = fixture(['"Signed in" is present.'], {cases: 2, mutate: refinement => {for (const scenario of refinement.scenarios) {const step = scenario.steps[0]; step.capability = 'mutations'; delete step.readOnlyContract; step.login = {user: 'tester', landmark: 'Signed in'}; step.expectations[0].conditions = [condition('"Signed in" is present.', 'present', 'Signed in')];}}});
    await next(login); await doCommand(login, 'begin-step', 's001'); await doCommand(login, 'native', 'goto', origin);
    let seen = await look(login); await doCommand(login, 'native', 'fill', reference(seen.snapshot, 'textbox', 'Username'), 'HARNESS_USERNAME_TESTER');
    seen = await look(login); await doCommand(login, 'native', 'fill', reference(seen.snapshot, 'textbox', 'Password'), 'HARNESS_PASSWORD_TESTER');
    await click(login, 'Sign in'); await checkPage(login, login.refinement.scenarios[0].steps[0].expectations[0].key, 1, 15000);
    await doCommand(login, 'save-login'); await ending(login, 'confirmed'); await finish(login);
    await next(login); await doCommand(login, 'begin-step', 's001'); await doCommand(login, 'native', 'goto', `${origin}/account`);
    await checkPage(login, login.refinement.scenarios[1].steps[0].expectations[0].key); await ending(login, 'none'); await finish(login);
    assert.equal(counts.logins, 1); return {scenarios: 2, logins: counts.logins};
  });
  await check('no-secret-leaks', async () => {
    assert(login); const report = writeExecutionReport(roots, login.executionId);
    const scan = directory => {for (const entry of readdirSync(directory, {withFileTypes: true})) {const file = join(directory, entry.name); if (entry.isDirectory()) {if (!['protected', 'auth'].includes(entry.name)) scan(file);} else if (/\.(json|jsonl|md|html|log)$/.test(entry.name)) {const text = readFileSync(file, 'utf8'); assert(!text.includes(credential));}}};
    scan(ownedFile(roots, login.executionId, '.scan').replace(/[/\\]\.scan$/, '')); scan(join(projectRoot, report.directory));
    assert(!existsSync(ownedFile(roots, login.executionId, 'auth'))); return {publicArtifactsChecked: true, savedAuthenticationRemoved: true};
  });
  await check('checked-observed-mixed', async () => {
    const text = '"Execution fixture" is present. Save button is disabled. "Panel" is blue. Panel contains 1 textbox.';
    const f = fixture([text], {mutate: refinement => {refinement.scenarios[0].steps[0].expectations[0].conditions = [condition('"Execution fixture" is present.', 'present', 'Execution fixture'), condition('Save button is disabled.', 'state:disabled', undefined, {element: {role: 'button', name: 'Save'}}), condition('"Panel" is blue.', 'observational'), condition('Panel contains 1 textbox.', 'count', 1, {region: {name: 'Panel'}})];}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'), key = begun.contracts[0].key;
    await doCommand(f, 'native', 'goto', origin); await checkPage(f, key);
    const seen = await look(f); await doCommand(f, 'check', key, '--condition', '2', '--read', `state ${reference(seen.snapshot, 'button', 'Save')}`);
    const observedSnapshot = await look(f), screenshot = await doCommand(f, 'evidence', 'screenshot');
    await doCommand(f, 'observe', key, 'PASS', '--condition', '3', '--observed', 'Panel is blue.', '--rationale', 'The visible panel background is blue.', '--why-not-checked', 'visual-only', '--evidence', `${observedSnapshot.evidenceId},${screenshot.evidenceId}`);
    const count = await doCommand(f, 'check', key, '--condition', '4', '--read', `count ${reference(observedSnapshot.snapshot, 'region', 'Panel')} textbox`); assert.equal(count.result.read.excerpt, '1');
    const end = await ending(f); assert.equal(end.expectations[0].method, 'mixed'); const view = await finish(f); assert.equal(view.scenarios[0].methods.mixed, 1); return {conditions: 4, checked: 3, observed: 1, expectationMethod: 'mixed', textboxCountExcludesOtherInputs: true};
  });
  await check('fail-finality', async () => {
    const f = fixture(['Status equals "Good".'], {mutate: refinement => {const step = refinement.scenarios[0].steps[0]; step.capability = 'mutations'; delete step.readOnlyContract; step.expectations[0].conditions = [condition('Status equals "Good".', 'equals', 'Good', {element: {role: 'textbox', name: 'Status'}})];}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'), key = begun.contracts[0].key;
    await doCommand(f, 'native', 'goto', origin); let seen = await look(f); assert.equal((await doCommand(f, 'check', key, '--read', `value ${reference(seen.snapshot, 'textbox', 'Status')}`)).result.status, 'FAIL');
    await click(f, 'Make good'); seen = await look(f); assert.equal((await doCommand(f, 'check', key, '--read', `value ${reference(seen.snapshot, 'textbox', 'Status')}`)).result.status, 'PASS'); await ending(f, 'confirmed'); await finish(f, 'FAIL'); return {historicalFailPreserved: true};
  });
  await check('asynchronous-artifact-binding', async () => {
    const f = fixture(['"Ready" is present.'], {mutate: refinement => {const step = refinement.scenarios[0].steps[0]; step.capability = 'mutations'; delete step.readOnlyContract; step.expectations[0].conditions = [condition('"Ready" is present.', 'present', 'Ready')];}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'), key = begun.contracts[0].key;
    await doCommand(f, 'native', 'goto', origin); await click(f, 'Start update'); const passed = await checkPage(f, key); assert.equal(passed.result.status, 'PASS');
    await delay(10500); const later = await look(f); assert(later.snapshot.includes('Changed')); await ending(f, 'confirmed');
    const view = await finish(f), row = view.runs.at(-1), earlier = row.result.evidence.find(record => record.id === passed.result.evidenceIds[0]);
    assert(readFileSync(join(row.roots.runRoot, earlier.path), 'utf8').includes('Ready')); return {checkBoundToOwnSnapshot: true, laterSnapshotChanged: true};
  });
  await check('integrity-stop', async () => {
    const f = fixture(['"Execution fixture" is present.', '"Execution fixture" is present.'], {mutate: refinement => {const later = refinement.scenarios[0].steps[1]; later.capability = 'mutations'; delete later.readOnlyContract;}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', origin); const passed = await checkPage(f, begun.contracts[0].key);
    writeFileSync(ownedFile(roots, f.executionId, `${f.runId}/evidence/${passed.result.evidenceIds[0]}`), 'Tampered fixture snapshot');
    const refused = await executeMain(roots, ['do', f.executionId, 'end-step', '--effect', 'none']); assert.equal(refused.reason, 'EVIDENCE_INTEGRITY_FAILURE');
    await awaitStatus(f, state => state.state === 'INTEGRITY_FAILURE'); const view = collectExecution(roots, f.executionId); assert.equal(view.scenarios[0].status, null);
    const observations = readBounded(ownedFile(roots, f.executionId, `${f.runId}/observations.json`));
    assert(observations.scenarios[0].attempts.filter(attempt => attempt.identity.invocationId === 's002').every(attempt => attempt.effect.certainty === 'not-executed'));
    assert(!existsSync(ownedFile(roots, f.executionId, `${f.runId}/protected`))); return {noVerdict: true, laterMutationNotDispatched: true, ownedSessionClosed: true};
  });
  await check('provenance-budget', async () => {
    const f = fixture(['Long status equals "Good".'], {mutate: refinement => {refinement.scenarios[0].steps[0].expectations[0].conditions = [condition('Long status equals "Good".', 'equals', 'Good', {element: {role: 'textbox', name: 'Long status'}})];}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', origin); const seen = await look(f), ref = reference(seen.snapshot, 'textbox', 'Long status');
    const reply = await doCommand(f, 'check', begun.contracts[0].key, '--read', `value ${ref}`); assert.equal(reply.result.status, 'FAIL'); assert(reply.result.read.excerpt.length <= 256); assert.equal(reply.result.read.value, undefined);
    await ending(f); const view = await finish(f, 'FAIL'), row = view.runs.at(-1);
    assert(row.result.evidence.filter(record => record.kind === 'assertion').every(record => record.bytes <= 64 * 1024));
    const report = writeExecutionReport(roots, f.executionId); assert.equal(report.scenarios[0].status, 'FAIL'); assert.equal(report.scenarios[0].state, 'ASSESSED');
    assert(row.result.evidence.some(record => record.kind === 'observation' && record.bytes > 100 * 1024));
    return {largeReadBytes: 100 * 1024, assertionsWithin64KiB: true, historicalFailPreserved: true, reportIntegrityValid: true};
  });
  await check('diagnostics-modes', async () => {
    const samples = {};
    for (const mode of ['end', 'per-step']) {
      const f = fixture(Array(3).fill('"Execution fixture" is present.'), {diagnostics: mode}); await next(f); let elapsed = 0;
      for (const step of f.refinement.scenarios[0].steps) {await doCommand(f, 'begin-step', step.id); await doCommand(f, 'native', 'goto', origin); await checkPage(f, step.expectations[0].key); const started = performance.now(); await ending(f); elapsed += performance.now() - started; await awaitStatus(f, state => !state.active || state.step !== step.id);}
      const view = await finish(f), diagnostics = view.runs.at(-1).diagnostics; assert.equal(diagnostics.length, mode === 'end' ? 1 : 6);
      assert(diagnostics.some(record => record.entries.some(entry => entry.kind === 'console'))); assert(diagnostics.some(record => record.entries.some(entry => entry.kind === 'request')));
      assert(!JSON.stringify(diagnostics).includes('privateQuery')); latency[mode] = Math.round(elapsed); samples[mode] = {steps: 3, captures: diagnostics.length, endStepTotalMs: latency[mode]};
    }
    return samples;
  });
  await check('read-retry', async mark => {
    mark('start');
    const f = fixture(['"Execution fixture" is present.']); await next(f); const begun = await doCommand(f, 'begin-step', 's001'); unavailable = true;
    mark('first-navigation'); const failed = await executeMain(roots, ['do', f.executionId, 'native', 'goto', origin]); assert.equal(failed.status, 'ERROR'); unavailable = false;
    mark('end-first-attempt'); await ending(f);
    mark('await-retry'); await awaitStatus(f, state => state.attempt === 2, 90000, state => mark('await-retry', {hostState: state?.state, attempt: state?.attempt}));
    mark('retry-navigation'); await doCommand(f, 'native', 'goto', origin);
    mark('retry-check'); await checkPage(f, begun.contracts[0].key);
    mark('end-retry'); await ending(f);
    mark('assessment'); const view = await finish(f), attempts = view.runs.at(-1).result.scenarios[0].attempts.filter(attempt => attempt.identity.invocationId === 's001');
    mark('attempt-count'); assert.equal(attempts.length, 2); return {attempts: 2, stability: view.runs.at(-1).result.stability};
  });
  await check('mutation-reconciliation', async () => {
    const f = fixture(['"Execution fixture" is present.'], {mutate: refinement => {const step = refinement.scenarios[0].steps[0]; step.capability = 'mutations'; delete step.readOnlyContract;}});
    await next(f); const begun = await doCommand(f, 'begin-step', 's001'); unavailable = true;
    const failed = await executeMain(roots, ['do', f.executionId, 'native', 'goto', origin]); assert.equal(failed.status, 'ERROR'); unavailable = false;
    const seen = await look(f); await doCommand(f, 'reconcile', 'no-effect', '--evidence', seen.evidenceId); await ending(f);
    await awaitStatus(f, state => state.attempt === 2); await doCommand(f, 'native', 'goto', origin); await checkPage(f, begun.contracts[0].key); await ending(f, 'none');
    const view = await finish(f), attempts = view.runs.at(-1).result.scenarios[0].attempts.filter(attempt => attempt.identity.invocationId === 's001'); assert.equal(attempts.length, 2); assert.equal(attempts[0].reconciliation.kind, 'confirmed-no-effect'); return {manualReconciliationBeforeRetry: true, businessMutations: counts.records};
  });
  await check('cleanup-lifecycle', async () => {
    const f = fixture(['"record-created" is present.', '"record-created" is absent.'], {mutate: refinement => {
      const [create, cleanup] = refinement.scenarios[0].steps; create.capability = cleanup.capability = 'mutations'; delete create.readOnlyContract; delete cleanup.readOnlyContract;
      create.expectations[0].conditions = [condition('"record-created" is present.', 'present', 'record-created')]; create.creates = [{resource: 'record', identityOutput: 'recordIdentity', intent: 'temporary', cleanupStep: cleanup.id}];
      cleanup.phase = 'CLEANUP'; cleanup.cleanupResource = 'record'; cleanup.inputs = [{name: 'recordIdentity', source: 'output:recordIdentity'}]; cleanup.expectations[0].conditions = [condition('"record-created" is absent.', 'absent', 'record-created')];
    }});
    await next(f); const create = await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', origin); await click(f, 'New record');
    let seen = await look(f); await doCommand(f, 'capture', 'recordIdentity', '--read', `text ${reference(seen.snapshot, 'heading', 'record-created')}`); await checkPage(f, create.contracts[0].key); await ending(f, 'confirmed');
    await awaitStatus(f, state => state.step === 's002'); const cleanup = await doCommand(f, 'begin-step', 's002'); await click(f, 'Delete record-created'); await checkPage(f, cleanup.contracts[0].key); await ending(f, 'confirmed');
    const view = await finish(f), resource = view.runs.at(-1).result.scenarios[0].resources.find(resource => resource.id === 'record'); assert.equal(resource.lifecycle.status, 'completed'); assert.equal(counts.records, 0); return {businessResource: 'completed', browserSession: 'completed', recordsRemaining: 0};
  });
  await check('killed-host-recovery', async () => {
    const f = fixture(['"Execution fixture" is present.']); await next(f); await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', origin);
    const oldRun = f.runId, owner = await lockStatus(roots); assert(owner.host?.pid); process.kill(owner.host.pid, 'SIGKILL');
    const deadline = Date.now() + 30000; while ((await processInventory()).some(process => process.pid === owner.host.pid && process.identity === owner.host.identity) && Date.now() < deadline) await delay(100);
    assert.equal(collectExecution(roots, f.executionId).scenarios[0].state, 'INTERRUPTED');
    await next(f, ['--rerun', f.refinement.scenarios[0].id]); assert(!existsSync(ownedFile(roots, f.executionId, `${oldRun}/protected`)));
    const begun = await doCommand(f, 'begin-step', 's001'); await doCommand(f, 'native', 'goto', origin); await checkPage(f, begun.contracts[0].key); await ending(f); const view = await finish(f);
    assert.equal(view.scenarios[0].history.length, 2); return {interruptedRunRetained: true, ownedSessionRecovered: true, rerun: 'PASS'};
  });
} finally {
  unavailable = false;
  const owner = await lockStatus(roots); if (owner) try {await executeMain(roots, ['stop', owner.executionId]);} catch { /* CI recovery uses the protected ownership receipt. */ }
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); fixtureServersClosed = true;
  const deadline = Date.now() + 30000; while ((await processInventory()).some(process => hosts.has(process.pid)) && Date.now() < deadline) await delay(100);
  delete process.env.EXECUTE_PROBE_USER; delete process.env.EXECUTE_PROBE_PASSWORD;
}
const assessment = {version: 1, status: completeExecuteChecks(checks) && fixtureServersClosed ? 'PASS' : 'FAIL', checks, diagnosticsLatencyMs: latency, fixtureServersClosed};
writeJson(join(projectRoot, 'execute-proof.json'), assessment); console.log(JSON.stringify({status: assessment.status, checks: checks.length}));
if (assessment.status !== 'PASS') process.exitCode = 1;
