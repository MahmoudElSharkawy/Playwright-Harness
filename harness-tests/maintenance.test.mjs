import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import * as generation from '../scripts/lib/generation/index.mjs';
import {transaction} from '../scripts/lib/generation/storage.mjs';
import {verifyGeneration} from '../scripts/lib/generation/verify.mjs';

const source = () => ({version: 1, id: 'maintenance', title: 'Synthetic maintenance', scenarios: [
  {id: 'case-1', title: 'Observe', steps: [{action: 'Observe the fixture', expected: ['The observation matches']}]}]});
const put = (root, path, value) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));};
const stateOf = f => transaction(f.roots, 'maintenance', state => state);
const history = f => readdirSync(join(f.roots.projectRoot, '.harness/state/generation/maintenance')).filter(name => name.endsWith('.json'))
  .map(name => [name, readFileSync(join(f.roots.projectRoot, '.harness/state/generation/maintenance', name), 'utf8')]);
const handoff = (f, input) => generation.createGenerationHandoff(input, [{run: f.run, roots: f.roots, observations: f.report}],
  generation.sourceExpectations(input).map(e => ({key: e.key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'})));
const candidate = input => ({config: 'playwright.config.mjs', tests: [{scenarioId: 'case-1', spec: 'tests/ObservationTests.spec.ts', project: 'native', titlePath: ['Observe'],
  mapping: [{step: 1, actions: ['ObservationPage.observe'], expectations: generation.sourceExpectations(input).map(e => ({key: e.key, validations: ['ObservationPage.verifyObservation']}))}]}]});

async function prepared(t, withCandidate = true) {
  const f = fixture(t); f.source = source(); f.handoff = handoff(f, f.source);
  put(f.roots.projectRoot, 'playwright.config.mjs', 'export default {};');
  put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// Synthetic gate fixture, not an application test.');
  put(f.roots.projectRoot, '.harness/state/maintenance/change.md', 'Synthetic owner acceptance / deployment evidence for contract tests only.');
  put(f.roots.projectRoot, '.harness/state/review.md', 'Synthetic independent-identity gate fixture; no production review claimed.');
  await generation.beginGeneration(f.roots, f.handoff, 'author');
  if (withCandidate) f.candidate = await generation.registerCandidate(f.roots, 'maintenance', candidate(f.source));
  f.change = {previousSourceFingerprint: f.handoff.fingerprint, artifact: '.harness/state/maintenance/change.md'};
  f.revised = structuredClone(f.source); f.revised.scenarios[0].steps[0].expected = ['The accepted new observation matches'];
  return f;
}
const review = (f, revision) => generation.recordGenerationReview(f.roots, 'maintenance', {revision, reviewer: 'independent-fixture', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
const revisionInput = f => ({...candidate(f.revised), repair: 'requirement-change', change: f.change});

test('accepted source revision retains the source identity, historical failure, review and repair budget', async t => {
  const f = await prepared(t); await review(f, f.candidate.revision);
  const blocked = await verifyGeneration(f.roots, 'maintenance'); assert.equal(blocked.status, 'BLOCKED');
  const before = await stateOf(f), files = history(f);
  const revised = await generation.reviseGeneration(f.roots, 'maintenance', handoff(f, f.revised), revisionInput(f));
  const after = await stateOf(f);
  assert.equal(after.handoff.source.id, before.handoff.source.id);
  assert.deepEqual(after.handoff.source, f.revised); assert.equal(after.rounds, 1);
  assert.deepEqual(after.runs, before.runs); assert.deepEqual(after.reviews, before.reviews);
  assert.deepEqual(after.candidates.slice(0, -1), before.candidates);
  assert.deepEqual(history(f).slice(0, files.length), files);
  assert.equal(revised.change.previousSourceFingerprint, f.handoff.fingerprint);
  assert.equal(revised.sourceFingerprint, after.handoff.fingerprint);
  assert.equal((await generation.generationStatus(f.roots, 'maintenance')).status, 'NEEDS_REVIEW');
  await assert.rejects(verifyGeneration(f.roots, 'maintenance'), /approval/);
});

test('revision of a prepared source without a generated candidate retains its history', async t => {
  const f = await prepared(t, false), before = history(f);
  const result = await generation.reviseGeneration(f.roots, 'maintenance', handoff(f, f.revised), revisionInput(f));
  assert.equal(result.round, 1); assert.deepEqual(history(f).slice(0, before.length), before);
  assert.equal((await stateOf(f)).candidates.length, 1);
});

for (const [name, mutate] of Object.entries({
  'stale source fingerprint': (f, input) => input.change.previousSourceFingerprint = 'stale',
  'missing acceptance': (f, input) => delete input.change,
  'missing acceptance file': (f, input) => input.change.artifact = '.harness/state/missing.md',
  'escaping acceptance path': (f, input) => input.change.artifact = '../outside.md',
  'ordinary repair classification': (f, input) => input.repair = 'script-defect',
  'legacy migration': (f, input) => input.migration = 'case-assertions',
  'incomplete mapping': (f, input) => input.tests[0].mapping = [],
})) test(`revision rejects ${name} without changing history`, async t => {
  const f = await prepared(t), input = revisionInput(f), before = history(f); mutate(f, input);
  await assert.rejects(generation.reviseGeneration(f.roots, 'maintenance', handoff(f, f.revised), input));
  assert.deepEqual(history(f), before);
});

test('revision rejects fabricated handoffs, unchanged sources and changed source identities', async t => {
  const f = await prepared(t), before = history(f);
  await assert.rejects(generation.reviseGeneration(f.roots, 'maintenance', structuredClone(handoff(f, f.revised)), revisionInput(f)), /assessing execution/);
  await assert.rejects(generation.reviseGeneration(f.roots, 'maintenance', handoff(f, f.source), revisionInput(f)), /changed source/);
  await assert.rejects(generation.reviseGeneration(f.roots, 'maintenance', handoff(f, {...f.revised, id: 'another-source'}), revisionInput(f)), /same source/);
  assert.deepEqual(history(f), before);
});

test('ordinary candidate registration cannot replace accepted source revision', async t => {
  const f = await prepared(t), before = history(f);
  await assert.rejects(generation.registerCandidate(f.roots, 'maintenance', revisionInput(f)), /revise/);
  assert.deepEqual(history(f), before);
});

test('application fix revalidation keeps the original oracle and blocked attempt', async t => {
  const f = await prepared(t); await review(f, f.candidate.revision);
  await verifyGeneration(f.roots, 'maintenance'); const before = await stateOf(f);
  const result = await generation.registerCandidate(f.roots, 'maintenance', {...candidate(f.source), repair: 'application-change', change: f.change});
  const after = await stateOf(f); assert.deepEqual(after.handoff, before.handoff); assert.deepEqual(after.runs, before.runs);
  assert.equal(result.round, 1); assert.equal((await generation.generationStatus(f.roots, 'maintenance')).greens, 0);
  await assert.rejects(verifyGeneration(f.roots, 'maintenance'), /approval/);
  await review(f, result.revision);
  put(f.roots.projectRoot, f.change.artifact, 'Altered evidence');
  assert.equal((await generation.generationStatus(f.roots, 'maintenance')).status, 'NEEDS_REVIEW');
});

test('application change requires evidence bound to the current source', async t => {
  const f = await prepared(t), before = history(f);
  for (const change of [undefined, {...f.change, previousSourceFingerprint: 'stale'}, {...f.change, artifact: '.harness/state/missing.md'}]) {
    await assert.rejects(generation.registerCandidate(f.roots, 'maintenance', {...candidate(f.source), repair: 'application-change', ...(change ? {change} : {})}));
  }
  assert.deepEqual(history(f), before);
});

test('source acceptance stays bound after a subsequent ordinary repair', async t => {
  const f = await prepared(t);
  await generation.reviseGeneration(f.roots, 'maintenance', handoff(f, f.revised), revisionInput(f));
  const repaired = await generation.registerCandidate(f.roots, 'maintenance', {...candidate(f.revised), repair: 'script-defect'});
  await review(f, repaired.revision);
  assert.equal((await generation.generationStatus(f.roots, 'maintenance')).status, 'UNVERIFIED');
  put(f.roots.projectRoot, f.change.artifact, 'Changed owner decision');
  assert.equal((await generation.generationStatus(f.roots, 'maintenance')).status, 'NEEDS_REVIEW');
  await assert.rejects(review(f, repaired.revision), /acceptance evidence/);
});

test('requirement changes, application fixes and normal repairs share one cumulative cap', async t => {
  const f = await prepared(t);
  await generation.registerCandidate(f.roots, 'maintenance', {...candidate(f.source), repair: 'script-defect'});
  await generation.registerCandidate(f.roots, 'maintenance', {...candidate(f.source), repair: 'application-change', change: f.change});
  await generation.reviseGeneration(f.roots, 'maintenance', handoff(f, f.revised), revisionInput(f));
  assert.equal((await stateOf(f)).rounds, 3); const before = history(f);
  f.change.previousSourceFingerprint = (await stateOf(f)).handoff.fingerprint;
  await assert.rejects(generation.registerCandidate(f.roots, 'maintenance', {...candidate(f.revised), repair: 'application-change', change: f.change}), /Three cumulative/);
  const next = structuredClone(f.revised); next.title = 'Another accepted revision';
  await assert.rejects(generation.reviseGeneration(f.roots, 'maintenance', handoff(f, next), revisionInput(f)), /Three cumulative/);
  await assert.rejects(generation.beginGeneration(f.roots, handoff(f, next), 'author'), /history/);
  assert.deepEqual(history(f), before);
});

test('revise CLI reassesses the handoff and registers a reviewed-change candidate atomically', async t => {
  const f = await prepared(t);
  put(f.roots.projectRoot, '.harness/sources/revised.json', f.revised);
  put(f.roots.projectRoot, '.harness/runs/run-1/inputs.json', f.run);
  put(f.roots.projectRoot, '.harness/runs/run-1/observations.json', f.report);
  const input = {source: '.harness/sources/revised.json', executions: [{snapshot: '.harness/runs/run-1/inputs.json', runRoot: '.harness/runs/run-1'}],
    bindings: [{key: generation.sourceExpectations(f.revised)[0].key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}], candidate: revisionInput(f)};
  put(f.roots.projectRoot, '.harness/state/revise.json', input);
  const args = [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'revise', '--project-root', f.roots.projectRoot, '--id', 'maintenance', '--input', '.harness/state/revise.json'];
  const result = spawnSync(process.execPath, args, {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'NEEDS_REVIEW');
  assert.equal((await stateOf(f)).rounds, 1); const before = history(f);
  const repeated = spawnSync(process.execPath, args, {encoding: 'utf8', windowsHide: true});
  assert.equal(repeated.status, 2); assert.deepEqual(history(f), before);
});
