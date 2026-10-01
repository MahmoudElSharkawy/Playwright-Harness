import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture, retry, resource, operation, attempt} from './fixtures/execution-core.mjs';
import {digest} from '../scripts/lib/execution-core/data.mjs';
import {reportView, renderJson, renderMarkdown, renderHtml, writeReports, attachResult} from '../scripts/lib/reporting/index.mjs';
import {allureInventory, generateAllure} from '../scripts/lib/reporting/allure.mjs';

const formats = view => [renderJson(view), renderMarkdown(view), renderHtml(view)];
for (const [expected, change] of [
  ['PASS', () => {}], ['FAIL', f => {f.current.assertions[0].status = 'FAIL'; f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION';}],
  ['NEEDS_REVIEW', f => {f.current.effect.certainty = 'uncertain';}], ...['BLOCKED', 'SKIPPED'].map(status => [status, f => {f.report.evidence = []; Object.assign(f.scenario, {disposition: status.toLowerCase(), reason: 'synthetic-selection', attempts: [], resources: [], outputRefs: []});}])
]) test(`all report formats preserve the core's ${expected} without inferring a verdict`, t => {
  const f = fixture(t); change(f); const result = f.assess(), view = reportView(result); assert.equal(result.status, expected);
  assert.equal(view.status, result.status); assert.deepEqual(view.counts, result.counts); assert.deepEqual(view.scenarios[0].counts, result.scenarios[0].counts);
  for (const text of formats(view)) assert(text.includes(expected));
  assert.throws(() => {view.status = 'PASS';});
});
test('safely recovered PASS shows the complete attempts and transient classification in every format', t => {
  const f = fixture(t); retry(f); const view = reportView(f.assess()); assert.equal(view.stability, 'recovered'); assert.equal(view.scenarios[0].attempts.length, 2);
  for (const text of formats(view)) {assert.match(text, /recovered/); assert.match(text, /attempt-1/); assert.match(text, /attempt-2/); assert.match(text, /TRANSPORT/);}
});
for (const [intent, action] of [['persistent', 'retain'], ['no-obligation', 'none']]) test(`${intent} remains an intentional disposition without invented cleanup`, t => {
  const f = fixture(t, {operations: [operation({capability: 'apiMutations'})]}); resource(f, intent);
  const view = reportView(f.assess()); assert.equal(view.status, 'PASS'); assert.equal(view.scenarios[0].resources[0].lifecycle.action, action);
  for (const text of formats(view)) {assert.match(text, new RegExp(intent)); assert.match(text, /not-required/); assert.doesNotMatch(text, /\bleak\b/i);}
});
for (const failure of ['pending', 'failed', 'conflict']) test(`required lifecycle ${failure} remains visible and cannot become a pass`, t => {
  const f = fixture(t); const record = resource(f, failure === 'conflict' ? 'restore' : 'temporary'); record.lifecycle.status = failure;
  const view = reportView(f.assess()); assert.equal(view.status, 'NEEDS_REVIEW'); assert.equal(view.scenarios[0].requiredLifecycleComplete, false);
  for (const text of formats(view)) assert.match(text, new RegExp(failure));
});
test('failed required cleanup cannot erase a reliable assertion FAIL', t => {
  const f = fixture(t); resource(f, 'temporary').lifecycle.status = 'failed'; f.current.assertions[0].status = 'FAIL';
  f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION';
  const view = reportView(f.assess()); assert.equal(view.status, 'FAIL'); assert.equal(view.scenarios[0].requiredLifecycleComplete, false); assert.match(renderHtml(view), /INCOMPLETE/);
});
test('reconciliation and affected-row facts survive presentation', t => {
  const f = fixture(t); retry(f); f.current.effect.certainty = 'uncertain';
  f.current.reconciliation = {kind: 'confirmed-no-effect', evidenceIds: [f.evidence(f.current, 'reconciliation')]};
  const view = reportView(f.assess()); for (const text of formats(view)) {assert.match(text, /EXERCISE/); assert.match(text, /confirmed-no-effect/);}
  const row = fixture(t); row.current.effect.certainty = 'confirmed'; row.current.effect.affectedRows = {actual: 1, expected: {min: 1, max: 1}};
  assert.deepEqual(reportView(row.assess()).scenarios[0].attempts[0].effect.affectedRows, row.current.effect.affectedRows);
});

for (const phase of ['SETUP', 'EXERCISE', 'VERIFY', 'CLEANUP', 'RESTORE']) test(`${phase} is shown from the actual attempt identity`, t => {
  const f = fixture(t); f.current.identity.phase = phase;
  // Register evidence under the actual phase rather than altering its frozen identity.
  f.report.evidence = []; f.current.evidenceIds = []; f.current.assertions[0].evidenceIds = [f.evidence(f.current)];
  for (const text of formats(reportView(f.assess()))) assert.match(text, new RegExp(phase));
});

test('completed restoration retains its guarded identity, effect and lifecycle evidence in every format', t => {
  const restoreOp = operation({id: 'restore', capability: 'apiMutations'}), f = fixture(t, {operations: [operation(), restoreOp]});
  const item = resource(f, 'restore', 'existing');
  const restore = attempt(f.run, restoreOp, {identity: {...f.current.identity, operationId: 'restore', invocationId: 'restore-call', attemptId: 'restore-attempt', phase: 'RESTORE'}, startedAt: 1200, endedAt: 1210, effect: {certainty: 'confirmed', resourceIds: ['fixture-1']}});
  f.scenario.attempts.push(restore); const evidence = f.evidence(restore, 'lifecycle');
  item.lifecycle = {action: 'restore', status: 'completed', attemptId: 'restore-attempt', evidenceIds: [evidence], guard: {kind: 'version', evidenceIds: [evidence]}};
  const view = reportView(f.assess()); assert.equal(view.status, 'PASS');
  for (const text of formats(view)) for (const word of ['fixture-1', 'existing', 'completed', 'restore-attempt', 'recordId', 'version', evidence]) assert(text.includes(word));
});

for (const fault of ['empty', 'incomplete', 'tampered', 'mismatched-count', 'missing-verification']) test(`Allure ${fault} cannot generate a success receipt`, async t => {
  const f = fixture(t), directory = fault === 'missing-verification' ? 'reports/generation/verify-fixture' : 'reports/allure/fixture';
  const path = join(f.roots.projectRoot, directory); mkdirSync(join(path, 'allure-results'), {recursive: true});
  if (fault !== 'empty') writeFileSync(join(path, 'allure-results/case-result.json'), '{"status":"passed"}');
  const artifacts = allureInventory(join(path, 'allure-results'));
  writeFileSync(join(path, 'capture.json'), JSON.stringify({status: fault === 'incomplete' ? 'FAILED' : 'CAPTURED', source: 'playwright-native', tests: fault === 'empty' ? 0 : fault === 'mismatched-count' ? 2 : 1, artifacts}));
  if (fault === 'tampered') writeFileSync(join(path, 'allure-results/case-result.json'), '{"status":"failed"}');
  assert.equal((await generateAllure(f.roots, directory)).status, 'FAILED'); assert.equal(existsSync(join(path, 'generation.json')), false);
});

test('Allure inventory refuses linked evidence and generation rejects output escapes', async t => {
  const f = fixture(t), path = join(f.roots.projectRoot, 'reports/allure/fixture/allure-results'); mkdirSync(path, {recursive: true});
  symlinkSync(f.roots.packageRoot, join(path, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => allureInventory(path));
  for (const directory of ['../outside', '.', 'reports/../source', 'reports\\nested']) assert.equal((await generateAllure(f.roots, directory)).status, 'FAILED');
});
test('a serialized, copied or fabricated claimed result/view is refused', t => {
  const f = fixture(t), result = f.assess();
  for (const fake of [JSON.parse(JSON.stringify(result)), {...result}, {status: 'PASS'}, null]) {assert.throws(() => reportView(fake)); assert.equal(writeReports(f.roots, fake).status, 'FAILED');}
  assert.throws(() => renderHtml(JSON.parse(renderJson(reportView(result)))));
});
test('sensitive outputs, before-state references, operation definitions and nonselected values are omitted', t => {
  const f = fixture(t); resource(f, 'restore').beforeStateRef = 'protected:private-before';
  const output = f.current.outputs[0]; delete output.value; output.sensitivity = 'sensitive'; output.protectedRef = 'protected:private-output';
  const view = reportView(f.assess());
  for (const text of formats(view)) {assert.doesNotMatch(text, /private-before|private-output|Synthetic sanitized observation|Observe a synthetic fixture/); assert.match(text, /redacted/);}
  assert.equal(view.scenarios[0].resources[0].restorationData, 'protected');
});
test('hostile text remains text in HTML and Markdown, while selected public values retain meaning in JSON', t => {
  const f = fixture(t), payload = '<script>alert(1)</script> [link](javascript:alert(1)) `</td><img src=x onerror=alert(1)> | **injection**';
  f.current.outputs[0].value = payload; const view = reportView(f.assess()), html = renderHtml(view), markdown = renderMarkdown(view);
  assert.equal(JSON.parse(renderJson(view)).scenarios[0].outputs[0].display, JSON.stringify(payload));
  assert.doesNotMatch(html, /<script|<img|href="javascript:/); assert.match(html, /&lt;script&gt;/); assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(markdown, /<script|\[link\]\(javascript|`<\/td>/);
});
test('large public output is explicitly clipped without losing outcome or traceability', t => {
  const f = fixture(t); f.current.outputs[0].value = 'z'.repeat(5000); const view = reportView(f.assess());
  assert.equal(view.scenarios[0].outputs[0].truncated, true); for (const text of formats(view)) assert.match(text, /truncated/);
  assert.equal(view.status, 'PASS'); assert.equal(view.scenarios[0].outputs[0].producer.attemptId, 'attempt-1');
});
test('report bundle is fresh, self-contained and manifest hashes describe all three files', t => {
  const f = fixture(t), result = f.assess(), receipt = writeReports(f.roots, result, {directory: 'reports/scoped-proof'});
  assert.equal(receipt.status, 'WRITTEN'); assert.equal(receipt.verdict, 'PASS'); assert.equal(receipt.artifacts.length, 3);
  for (const artifact of receipt.artifacts) {const bytes = readFileSync(join(f.roots.projectRoot, receipt.directory, artifact.path)); assert.equal(bytes.length, artifact.bytes); assert.equal(digest(bytes), artifact.sha256);}
  assert.equal(writeReports(f.roots, result, {directory: 'reports/scoped-proof'}).status, 'FAILED'); assert.equal(result.status, 'PASS');
});
test('report output cannot overwrite consumer code or escape through paths and junctions', t => {
  const f = fixture(t), result = f.assess();
  for (const directory of ['.', '../outside', 'src/pages', 'reports/../source', 'reports\\nested', 'reports/C:bad']) assert.equal(writeReports(f.roots, result, {directory}).status, 'FAILED');
  mkdirSync(join(f.roots.projectRoot, 'reports')); symlinkSync(f.roots.packageRoot, join(f.roots.projectRoot, 'reports/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(writeReports(f.roots, result, {directory: 'reports/linked/m14-escape'}).status, 'FAILED');
});
test('reporting failure does not change verdict or throw across an operation boundary', async t => {
  const f = fixture(t), result = f.assess();
  assert.equal((await attachResult({info() {throw new Error('No native context');}}, result)).status, 'NOT_IN_TEST');
  assert.equal((await attachResult({info: () => ({attach: async () => {throw new Error('Disk failure');}})}, result)).status, 'FAILED');
  assert.equal(result.status, 'PASS');
});
test('attachments use the current native TestInfo with stable names and bounded sanitized content', async t => {
  const f = fixture(t), attached = [], receipt = await attachResult({info: () => ({attach: async (name, body) => attached.push({name, ...body})})}, f.assess());
  assert.equal(receipt.status, 'ATTACHED'); assert.deepEqual(attached.map(a => a.name), ['Harness execution result', 'Harness execution report']);
  assert.deepEqual(attached.map(a => a.contentType), ['application/json', 'text/html']); assert.equal(JSON.parse(attached[0].body).status, 'PASS');
});
test('CLI reassesses original observations instead of trusting stored verdict JSON', t => {
  const f = fixture(t); writeFileSync(join(f.roots.projectRoot, 'inputs.json'), JSON.stringify(f.run)); writeFileSync(join(f.roots.runRoot, 'observations.json'), JSON.stringify(f.report));
  writeFileSync(join(f.roots.runRoot, 'result.json'), '{"status":"FAIL"}');
  const args = [join(f.roots.packageRoot, 'scripts/render-results.mjs'), '--project-root', f.roots.projectRoot, '--snapshot', 'inputs.json', '--run-root', '.harness/runs/run-1', '--output', 'reports/cli'];
  const good = spawnSync(process.execPath, args, {encoding: 'utf8'}); assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(good.stdout).verdict, 'PASS');
  writeFileSync(join(f.roots.runRoot, f.report.evidence[0].path), 'tampered'); args[args.length - 1] = 'reports/invalid';
  const bad = spawnSync(process.execPath, args, {encoding: 'utf8'}); assert.equal(bad.status, 2); assert.equal(existsSync(join(f.roots.projectRoot, 'reports/invalid')), false);
});
