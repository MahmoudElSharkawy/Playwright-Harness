import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture, retry, resource} from './fixtures/execution-core.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview, generationStatus, verificationRecord} from '../scripts/lib/generation/index.mjs';
import {snapshot, transaction, reviewArtifact} from '../scripts/lib/generation/storage.mjs';
import {selectTests, assessVerification, verifyGeneration} from '../scripts/lib/generation/verify.mjs';
import GenerationReporter from '../scripts/lib/generation/reporter.cjs';

const source = () => ({version: 1, id: 'suite', title: 'Synthetic source', scenarios: [{id: 'case-1', title: 'Observe', steps: [{action: 'Observe the fixture', expected: ['The synthetic observation matches']}]}]});
const put = (root, path, content) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));};
const handoff = (f, input = source()) => createGenerationHandoff(input, [{run: f.run, roots: f.roots, observations: f.report}], sourceExpectations(input).map(e => ({key: e.key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'})));
const candidate = (input = source()) => ({config: 'playwright.config.mjs', tests: [{scenarioId: 'case-1', spec: 'tests/ObservationTests.spec.ts', project: 'native', titlePath: ['Observation', 'matches'],
  mapping: input.scenarios[0].steps.map((step, index) => ({step: index + 1, actions: ['ObservationPage.observe'], expectations: sourceExpectations(input).filter(e => e.step === index + 1).map(e => ({key: e.key, validations: ['ObservationPage.verifyObservation']}))}))} ]});
async function prepared(t) {
  const f = fixture(t); put(f.roots.projectRoot, 'playwright.config.mjs', 'export default {};'); put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// synthetic contract fixture');
  await beginGeneration(f.roots, handoff(f), 'author'); f.candidate = await registerCandidate(f.roots, 'suite', candidate());
  put(f.roots.projectRoot, '.harness/state/review.md', 'Synthetic review for gate tests only; not an independent production review.');
  f.review = () => ({revision: f.candidate.revision, reviewer: 'synthetic-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  return f;
}
function nativeReport(input = candidate()) {
  return {version: 1, invocation: 'verify-one', status: 'passed', errors: 0, workers: 1, forbidOnly: true,
    tests: input.tests.map((t, i) => ({...t, id: `native-${i}`, nativeFile: 'ObservationTests.spec.ts', expectedStatus: 'passed', retries: 0, repeatEachIndex: 0,
      results: [{status: 'passed', retry: 0, errors: 0, expectations: [{key: sourceExpectations(source())[0].key, assertions: 1, failed: false}]}]}))};
}

test('handoff reassesses evidence and preserves source text, operations and assertion identities', t => {
  const f = fixture(t), result = handoff(f); assert.equal(result.expectations.length, 1); assert.deepEqual(result.source, source()); assert.equal(result.observations[0].status, 'PASS'); assert.equal(result.observations[0].scenarios[0].attempts[0].assertions[0].id, 'visible');
});
test('handoff cannot import a fabricated claimed verdict', async t => {const f = fixture(t); await assert.rejects(beginGeneration(f.roots, structuredClone(handoff(f)), 'author'), /assessing execution/);});
test('altered evidence prevents handoff', t => {const f = fixture(t); writeFileSync(join(f.roots.runRoot, f.report.evidence[0].path), 'changed'); assert.throws(() => handoff(f));});
test('recovered pass stays recovered and retains both attempts', t => {const f = fixture(t); f.current.effect.certainty = 'not-executed'; retry(f); const h = handoff(f); assert.equal(h.observations[0].stability, 'recovered'); assert.equal(h.observations[0].scenarios[0].attempts.length, 2);});
test('reliable observed failure does not rewrite the expected value', t => {const f = fixture(t); f.current.assertions[0].status = 'FAIL'; f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION'; const h = handoff(f); assert.equal(h.observations[0].status, 'FAIL'); assert.deepEqual(h.source, source());});
test('intentional persistence does not block generation', t => {const f = fixture(t); resource(f); assert.equal(handoff(f).observations[0].scenarios[0].resources[0].lifecycle.action, 'retain');});
test('unfinished required cleanup blocks generation', t => {const f = fixture(t); resource(f, 'temporary'); assert.throws(() => handoff(f));});
test('zero source expectations and missing or collapsed bindings are rejected', t => {const f = fixture(t), s = source(); s.scenarios[0].steps[0].expected = []; assert.throws(() => handoff(f, s)); s.scenarios[0].steps[0].expected = ['One', 'Two']; assert.throws(() => handoff(f, s), /bindings/);});
test('source generation cannot restart to erase repair history', async t => {const f = await prepared(t); await assert.rejects(beginGeneration(f.roots, handoff(f), 'author'), /history/);});
test('author cannot approve own generated files', async t => {const f = await prepared(t); await assert.rejects(recordGenerationReview(f.roots, 'suite', {...f.review(), reviewer: 'author'}), /Independent/);});
test('old revision cannot be approved', async t => {const f = await prepared(t); await assert.rejects(recordGenerationReview(f.roots, 'suite', {...f.review(), revision: 'previous'}), /revision/);});
test('blocking findings must be resolved or explicitly accepted', async t => {
  const f = await prepared(t), finding = {id: 'F1', blocking: true, resolution: 'open', reason: 'Assertion differs from source.'};
  await assert.rejects(recordGenerationReview(f.roots, 'suite', {...f.review(), findings: [finding]}), /remain open/);
  await recordGenerationReview(f.roots, 'suite', {...f.review(), findings: [{...finding, resolution: 'accepted', reason: 'Synthetic acceptance record for this unit test.'}]});
  assert.equal((await generationStatus(f.roots, 'suite')).status, 'UNVERIFIED');
});
test('review evidence drift invalidates approval', async t => {const f = await prepared(t); await recordGenerationReview(f.roots, 'suite', f.review()); put(f.roots.projectRoot, '.harness/state/review.md', 'changed'); assert.equal((await generationStatus(f.roots, 'suite')).status, 'NEEDS_REVIEW');});
test('new helper, changed data and deleted dependencies change snapshot', async t => {const f = await prepared(t), first = snapshot(f.roots); put(f.roots.projectRoot, 'src/utils/Shared.ts', 'export const value = 2;'); assert.notEqual(snapshot(f.roots).fingerprint, first.fingerprint); await assert.rejects(recordGenerationReview(f.roots, 'suite', f.review()), /changed/);});
test('runtime state does not invalidate candidate and protected credentials are not snapshotted', async t => {const f = await prepared(t), first = snapshot(f.roots); put(f.roots.projectRoot, '.harness/runs/new/result.json', {}); put(f.roots.projectRoot, '.env', 'SYNTHETIC_REF=unused'); assert.equal(snapshot(f.roots).fingerprint, first.fingerprint);});
test('repairs reset review and are capped at three cumulatively', async t => {
  const f = await prepared(t);
  for (let round = 1; round <= 3; round++) {put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', `// revision ${round}`); f.candidate = await registerCandidate(f.roots, 'suite', {...candidate(), repair: 'review-findings'}); assert.equal(f.candidate.round, round); assert.equal((await generationStatus(f.roots, 'suite')).status, 'NEEDS_REVIEW');}
  await assert.rejects(registerCandidate(f.roots, 'suite', {...candidate(), repair: 'environment'}), /Three cumulative/);
});
test('subsequent repair cannot be unclassified', async t => {const f = await prepared(t); await assert.rejects(registerCandidate(f.roots, 'suite', candidate()), /classify/);});
test('snapshot rejects linked behavior escaping project', async t => {const f = await prepared(t); symlinkSync(f.roots.packageRoot, join(f.roots.projectRoot, 'linked-code'), process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => snapshot(f.roots), /link/);});
test('exclusive writer refuses overlapping ledger mutation', async t => {const f = await prepared(t); await transaction(f.roots, 'suite', async () => {await assert.rejects(registerCandidate(f.roots, 'suite', candidate()), /EEXIST/);});});
test('history tampering or gaps never count as valid state', async t => {const f = await prepared(t), dir = join(f.roots.projectRoot, '.harness/state/generation/suite'), file = join(dir, readdirSync(dir).sort()[0]); const json = JSON.parse(readFileSync(file)); json.state.rounds = 0.5; writeFileSync(file, JSON.stringify(json)); await assert.rejects(generationStatus(f.roots, 'suite'), /integrity/);});

test('exact native scope with executed assertions is green', t => {const f = fixture(t), h = handoff(f), report = nativeReport(), selected = selectTests(candidate(), report); assert.deepEqual(assessVerification(h, selected, report, 'verify-one', 0), {status: 'PASS', tests: 1, expectations: 1});});
for (const [name, mutate] of Object.entries({
  'empty scope': r => r.tests = [], 'extra tests': r => r.tests.push({...r.tests[0], id: 'extra'}), 'wrong identity': r => r.invocation = 'other',
  'skipped test': r => r.tests[0].results[0].status = 'skipped', 'expected failure': r => r.tests[0].expectedStatus = 'failed',
  'retry enabled': r => r.tests[0].retries = 1, 'retried green': r => r.tests[0].results[0].retry = 1, 'repeated test': r => r.tests[0].repeatEachIndex = 1,
  'missing assertion': r => r.tests[0].results[0].expectations = [], 'empty marker': r => r.tests[0].results[0].expectations[0].assertions = 0,
  'wrong assertion': r => r.tests[0].results[0].expectations[0].key = 'different', 'duplicate assertion': r => r.tests[0].results[0].expectations.push({...r.tests[0].results[0].expectations[0]}),
  'failed assertion': r => r.tests[0].results[0].expectations[0].failed = true, 'soft failure': r => r.tests[0].results[0].errors = 1,
  'global error': r => r.errors = 1, 'parallel execution': r => r.workers = 2, 'partial result': r => r.tests[0].results = [], 'second result': r => r.tests[0].results.push(r.tests[0].results[0])
})) test(`verification rejects ${name}`, t => {const f = fixture(t), h = handoff(f), report = nativeReport(), selected = selectTests(candidate(), report); mutate(report); assert.throws(() => assessVerification(h, selected, report, 'verify-one', 0));});
test('nonzero native exit never passes', t => {const f = fixture(t), report = nativeReport(); assert.throws(() => assessVerification(handoff(f), selectTests(candidate(), report), report, 'verify-one', 1));});
test('unreviewed candidate cannot dispatch verification', async t => {const f = await prepared(t); await assert.rejects(verifyGeneration(f.roots, 'suite'), /approval/);});
test('missing native installation records blocked dispatch and prevents retry-to-green', async t => {const f = await prepared(t); await recordGenerationReview(f.roots, 'suite', f.review()); const run = await verifyGeneration(f.roots, 'suite'); assert.equal(run.status, 'BLOCKED'); assert.equal((await generationStatus(f.roots, 'suite')).greens, 0); await assert.rejects(verifyGeneration(f.roots, 'suite'), /retry-to-green/);});
test('a started crash is visible and cannot be silently replayed', async t => {const f = await prepared(t); await recordGenerationReview(f.roots, 'suite', f.review()); await transaction(f.roots, 'suite', (state, save) => {state.runs.push({id: 'interrupted', revision: f.candidate.revision, status: 'STARTED'}); save(state);}); assert.equal((await generationStatus(f.roots, 'suite')).status, 'NEEDS_REVIEW'); await assert.rejects(verifyGeneration(f.roots, 'suite'), /retry-to-green/);});
test('local CLI reconstructs frozen runs and prepares without ADO or an AI host', t => {
  const f = fixture(t), input = source(); put(f.roots.projectRoot, 'source.json', input);
  put(f.roots.projectRoot, '.harness/runs/run-1/inputs.json', f.run); put(f.roots.projectRoot, '.harness/runs/run-1/observations.json', f.report);
  put(f.roots.projectRoot, '.harness/state/prepare.json', {source: 'source.json', author: 'cli-author', executions: [{snapshot: '.harness/runs/run-1/inputs.json', runRoot: '.harness/runs/run-1'}], bindings: [{key: sourceExpectations(input)[0].key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}]});
  const result = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'prepare', '--project-root', f.roots.projectRoot, '--input', '.harness/state/prepare.json'], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).expectations, 1);
});
test('CLI rejects fabricated input fingerprints and withholds diagnostic payloads', t => {
  const f = fixture(t); put(f.roots.projectRoot, 'source.json', source());
  put(f.roots.projectRoot, '.harness/runs/run-1/inputs.json', {...f.run, inputFingerprint: 'forged'});
  put(f.roots.projectRoot, '.harness/state/prepare.json', {source: 'source.json', author: 'cli-author', executions: [{snapshot: '.harness/runs/run-1/inputs.json', runRoot: '.harness/runs/run-1'}], bindings: []});
  const result = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'prepare', '--project-root', f.roots.projectRoot, '--input', '.harness/state/prepare.json'], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 2); assert(!result.stderr.includes('forged')); assert.equal(JSON.parse(result.stderr).status, 'BLOCKED');
});

function caseReport() {
  const report = nativeReport(); report.version = 2;
  report.tests[0].results[0] = {status: 'passed', retry: 0, errors: 0, assertions: {passed: 1, failed: 0}, skippedSteps: 0};
  return report;
}
test('v2 verifies case assertion evidence without runtime source markers', t => {
  const f = fixture(t), report = caseReport();
  assert.deepEqual(assessVerification(handoff(f), selectTests(candidate(), report), report, 'verify-one', 0), {status: 'PASS', tests: 1, gate: 'case-assertions'});
});
for (const [name, mutate] of Object.entries({
  'zero assertions': r => r.assertions.passed = 0,
  'caught failure': r => r.assertions.failed = 1,
  'step skip': r => r.skippedSteps = 1,
  'negative count': r => r.assertions.failed = -1,
  'fractional count': r => r.assertions.passed = 0.5,
  'string count': r => r.assertions.passed = '1',
  'missing count': r => delete r.skippedSteps,
  'mixed evidence': r => r.expectations = [],
})) test(`v2 refuses ${name}`, t => {
  const f = fixture(t), report = caseReport(); mutate(report.tests[0].results[0]);
  assert.throws(() => assessVerification(handoff(f), selectTests(candidate(), report), report, 'verify-one', 0));
});
test('v1 receipts cannot carry v2 evidence', t => {
  const f = fixture(t), report = nativeReport(); report.tests[0].results[0].assertions = {passed: 1, failed: 0};
  assert.throws(() => assessVerification(handoff(f), selectTests(candidate(), report), report, 'verify-one', 0));
});

const expectStep = (patch = {}) => ({category: 'expect', title: 'Expect the observed value', duration: 1, steps: [], annotations: [], ...patch});
function reporterResult(steps) {
  const reporter = new GenerationReporter(); reporter.report.tests = [{id: 'native', results: []}];
  reporter.onTestEnd({id: 'native', expectedStatus: 'passed'}, {status: 'passed', retry: 0, errors: [], steps});
  assert.equal(reporter.report.version, 2); return reporter.report.tests[0].results[0];
}
test('reporter excludes lifecycle checks and incomplete assertions from passing evidence', () => {
  const result = reporterResult([{category: 'hook', steps: [expectStep()]}, {category: 'fixture', steps: [{category: 'test.step', steps: [expectStep()]}]}, expectStep({duration: -1})]);
  assert.deepEqual(result.assertions, {passed: 0, failed: 0});
});
test('reporter uses the terminal polling outcome but finds ordinary swallowed assertion failures', () => {
  const result = reporterResult([expectStep({steps: [expectStep({error: {message: 'retry'}}), expectStep()]}), {category: 'test.step', steps: [expectStep({error: {message: 'caught'}})]}]);
  assert.deepEqual(result.assertions, {passed: 1, failed: 1});
});
test('reporter excludes only explicitly titled utility probes', () => {
  const result = reporterResult([expectStep({title: 'Probe gate', location: {file: 'C:\\consumer\\src\\utils\\UiControls.ts'}, error: {message: 'probe'}}),
    expectStep({title: 'Probe gate', location: {file: '/consumer/src/pages/GatePage.ts'}}), expectStep({title: 'Probe gate'})]);
  assert.deepEqual(result.assertions, {passed: 2, failed: 0});
});
test('reporter retains lifecycle failures and counts step skips even within expect containers', () => {
  const result = reporterResult([{category: 'hook', steps: [expectStep({error: {message: 'cleanup'}})]},
    {category: 'test.step', annotations: [{type: 'skip'}], steps: []}, expectStep({steps: [{category: 'test.step', annotations: [{type: 'skip'}], steps: []}]})]);
  assert.deepEqual(result.assertions, {passed: 1, failed: 1}); assert.equal(result.skippedSteps, 2);
});

for (const [name, change, code] of [
  ['missing rows', c => delete c.tests[0].mapping, 'MAPPING_STEPS'],
  ['duplicate rows', c => c.tests[0].mapping.push(c.tests[0].mapping[0]), 'MAPPING_STEPS'],
  ['foreign step', c => c.tests[0].mapping[0].step = 2, 'MAPPING_STEPS'],
  ['missing expectation', c => c.tests[0].mapping[0].expectations = [], 'MAPPING_KEYS'],
  ['duplicate expectation', c => c.tests[0].mapping[0].expectations.push(c.tests[0].mapping[0].expectations[0]), 'MAPPING_KEYS'],
  ['foreign expectation', c => c.tests[0].mapping[0].expectations[0].key = 'unknown', 'MAPPING_KEYS'],
  ['empty validations', c => c.tests[0].mapping[0].expectations[0].validations = [], 'MAPPING_REFERENCES'],
  ['malformed reference', c => c.tests[0].mapping[0].actions = ['arbitrary code()'], 'MAPPING_REFERENCES'],
]) test(`candidate rejects ${name} without consuming a repair`, async t => {
  const f = await prepared(t), input = {...candidate(), repair: 'script-defect'}; change(input);
  await assert.rejects(registerCandidate(f.roots, 'suite', input), error => error.code === code);
  const state = await transaction(f.roots, 'suite', state => state); assert.equal(state.rounds, 0); assert.equal(state.candidates.length, 1);
});
test('mapping covers action-only and verification-only steps without lexical source analysis', async t => {
  const f = fixture(t), input = source(); input.scenarios[0].steps.unshift({action: 'Open the view', expected: []});
  put(f.roots.projectRoot, 'playwright.config.mjs', 'export default {};'); put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// Reviewer resolves business methods; registration validates mapping structure only.');
  await beginGeneration(f.roots, handoff(f, input), 'author');
  const mapped = candidate(input); mapped.tests[0].mapping[1].actions = [];
  const result = await registerCandidate(f.roots, 'suite', mapped); assert.deepEqual(result.tests[0].mapping, mapped.tests[0].mapping);
});

async function legacy(t, rounds = 3, statuses = ['PASS', 'FAIL', 'STARTED']) {
  const f = fixture(t), input = candidate();
  put(f.roots.projectRoot, input.config, 'export default {};'); put(f.roots.projectRoot, input.tests[0].spec, '// Legacy consumer');
  put(f.roots.projectRoot, '.harness/state/legacy-review.md', 'Synthetic historical review.');
  await beginGeneration(f.roots, handoff(f), 'author');
  await transaction(f.roots, 'suite', (state, save) => {
    state.rounds = rounds;
    const old = structuredClone(input); delete old.tests[0].mapping;
    state.candidates.push({...old, revision: 'legacy-revision', snapshot: snapshot(f.roots), round: rounds});
    state.reviews.push({revision: 'legacy-revision', reviewer: 'legacy-reviewer', verdict: 'APPROVE', findings: [], artifact: reviewArtifact(f.roots, '.harness/state/legacy-review.md')});
    for (const status of statuses) state.runs.push({id: `legacy-${status}`, revision: 'legacy-revision', status});
    save(state);
  });
  return {...f, input, before: structuredClone(await transaction(f.roots, 'suite', state => state))};
}
for (const rounds of [0, 3]) test(`legacy migration preserves history and repair count ${rounds}`, async t => {
  const f = await legacy(t, rounds);
  assert.equal((await generationStatus(f.roots, 'suite')).status, 'NEEDS_REVIEW');
  put(f.roots.projectRoot, f.input.tests[0].spec, '// Migration removes runtime source markers.');
  const migrated = await registerCandidate(f.roots, 'suite', {...f.input, migration: 'case-assertions'});
  assert.equal(migrated.round, rounds); assert.equal(migrated.gate, 'case-assertions');
  const after = await transaction(f.roots, 'suite', state => state);
  assert.equal(after.rounds, rounds); assert.deepEqual(after.candidates.slice(0, -1), f.before.candidates);
  for (const name of ['reviews', 'runs', 'handoff']) assert.deepEqual(after[name], f.before[name]);
  assert.equal((await verificationRecord(f.roots, 'suite', 'legacy-FAIL')).status, 'FAIL');
  await assert.rejects(verifyGeneration(f.roots, 'suite'), /approval/);
  await assert.rejects(registerCandidate(f.roots, 'suite', {...f.input, migration: 'case-assertions'}), /only once/);
});
test('migration cannot change native scope or bypass a combined repair at the budget limit', async t => {
  const f = await legacy(t), changed = structuredClone(f.input); changed.tests[0].titlePath[1] = 'different';
  await assert.rejects(registerCandidate(f.roots, 'suite', {...changed, migration: 'case-assertions'}), /preserve/);
  await assert.rejects(registerCandidate(f.roots, 'suite', {...f.input, migration: 'case-assertions', repair: 'script-defect'}), /Three cumulative/);
  assert.deepEqual(await transaction(f.roots, 'suite', state => state), f.before);
});
test('mixed migration charges a repair and ordinary v2 registration permanently closes the exemption', async t => {
  const mixed = await legacy(t, 1); const migrated = await registerCandidate(mixed.roots, 'suite', {...mixed.input, migration: 'case-assertions', repair: 'script-defect'});
  assert.equal(migrated.round, 2);
  const ordinary = await legacy(t, 1); const repaired = await registerCandidate(ordinary.roots, 'suite', {...ordinary.input, repair: 'review-findings'});
  assert.equal(repaired.round, 2);
  await assert.rejects(registerCandidate(ordinary.roots, 'suite', {...ordinary.input, migration: 'case-assertions'}), /only once/);
});
test('migration does not grant later free repairs or apply to a new source', async t => {
  const f = await legacy(t); await registerCandidate(f.roots, 'suite', {...f.input, migration: 'case-assertions'});
  await assert.rejects(registerCandidate(f.roots, 'suite', {...f.input, repair: 'script-defect'}), /Three cumulative/);
  const fresh = fixture(t); await beginGeneration(fresh.roots, handoff(fresh), 'author');
  put(fresh.roots.projectRoot, 'playwright.config.mjs', 'export default {};'); put(fresh.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// Initial candidate');
  await assert.rejects(registerCandidate(fresh.roots, 'suite', {...candidate(), migration: 'case-assertions'}), /only once/);
});
test('CLI mapping diagnostics expose fixed reason codes without source references', async t => {
  const f = await prepared(t), input = {...candidate(), repair: 'script-defect'};
  input.tests[0].mapping[0].expectations[0].validations = ['DoNotEcho.privateOperation()'];
  put(f.roots.projectRoot, '.harness/state/candidate.json', input);
  const result = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'candidate', '--project-root', f.roots.projectRoot, '--id', 'suite', '--input', '.harness/state/candidate.json'], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 2); assert.equal(JSON.parse(result.stderr).code, 'MAPPING_REFERENCES'); assert(!result.stderr.includes('DoNotEcho'));
});
