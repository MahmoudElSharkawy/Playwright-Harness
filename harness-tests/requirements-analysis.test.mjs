import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, readRequirements, importDecisions, planningHandoff, updateInventory, readReviewHandoff, startRequirementsReview, saveRequirements, reviewDifferences} from '../scripts/lib/requirements/index.mjs';
import {resolveGapCue, GAPCUE, validateFindings} from '../scripts/lib/requirements/gapcue.mjs';
import {bindSyntheticReview, nativeDecisions} from './fixtures/requirements.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const local = () => ({version: 1, project: 'synthetic-shop', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]});
const put = (roots, path, content) => {const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content)); return path;};
const fixture = () => {const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-requirements-'))); put(roots, 'story.md', 'Names allow spaces & special characters.\nResponse time is unspecified.\n'); return roots;};

test('local capture produces one stable inventory with unresolved acceptance and planning references', async () => {
  const roots = fixture(), source = await captureRequirements(roots, local());
  const result = prepareRequirements(roots, 'checkout', source);
  assert.equal(result.inventory.length, 2);
  assert(result.inventory.every(item => item.disposition === 'unknown' && item.evidence.length === 0));
  const plan = planningHandoff(roots, 'checkout');
  assert.deepEqual(plan.requirements.map(item => item.id), result.inventory.map(item => item.id));
  assert.equal(plan.inventory, result.inventoryPath);
  assert.equal(plan.analysisInvocations, 0);
  assert.equal(readRequirements(roots, 'checkout').snapshot, source.fingerprint);
});

test('incomplete and incompatible imports preserve the last valid state', async () => {
  const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const before = readRequirements(roots, 'checkout');
  put(roots, 'bad.json', '{"schema":2}');
  assert.throws(() => importDecisions(roots, 'checkout', 'bad.json'), /review|handoff/i);
  assert.deepEqual(readRequirements(roots, 'checkout'), before);
});

test('changed source invalidates downstream references while preserving stable IDs', async () => {
  const roots = fixture(), source = await captureRequirements(roots, local());
  const before = prepareRequirements(roots, 'checkout', source), plan = planningHandoff(roots, 'checkout');
  put(roots, 'story.md', 'Names allow spaces & special characters.\nResponse time is below 2 seconds.\n');
  const after = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  assert.equal(after.inventory[0].id, before.inventory[0].id);
  assert.equal(after.inventory[1].id, before.inventory[1].id);
  assert.notEqual(plan.snapshot, after.snapshot);
  assert(after.inventory.every(item => item.disposition !== 'accepted'));
  assert(after.staleRequirementIds.includes(after.inventory[1].id));
  assert.equal(planningHandoff(roots, 'checkout').analysisInvocations, 0);
});

test('complete native exports retain original bytes and survive fresh-process readback', async () => {
  const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const state = bindSyntheticReview(roots), decisions = nativeDecisions(state);
  decisions.custom.push({id: 'own-1', kind: 'gap', title: 'Data', why: 'Missing precondition', q: '<p>Which data?</p>', anchors: []}); decisions.status['own-1'] = 'oos';
  const original = JSON.stringify(decisions, null, 4) + '\n'; put(roots, 'export.json', original);
  const imported = importDecisions(roots, 'checkout', 'export.json');
  assert.equal(readFileSync(join(roots.projectRoot, imported.review.handoff.path), 'utf8'), original);
  assert.deepEqual(readReviewHandoff(roots, imported), decisions);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/requirements-analysis.mjs', import.meta.url)), 'read', '--id', 'checkout', '--project-root', roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).handoff, decisions);
  assert(imported.inventory.every(entry => entry.disposition === 'unknown'));
});

test('foreign, truncated, browser-unsaved and unsafe imports leave valid handoff untouched', async () => {
  const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const state = bindSyntheticReview(roots), decisions = nativeDecisions(state); put(roots, 'good.json', decisions);
  const valid = importDecisions(roots, 'checkout', 'good.json');
  const variants = [
    {...decisions, story: 'another-consumer'}, {...decisions, schema: 3}, {...decisions, comment: null},
    {...decisions, qEdit: {} , custom: null}, {...decisions, gapcue: undefined},
    {...decisions, status: {unknown: 'approved'}}, {...decisions, comment: '<img src=x onerror=alert(1)>'},
    {...decisions, status: true, qEdit: true}, {...decisions, status: 1, qEdit: 1},
    {...decisions, comment: '<p style="background:url(https://example.test)">text</p>'}
  ];
  for (const value of variants) {put(roots, 'bad.json', value); assert.throws(() => importDecisions(roots, 'checkout', 'bad.json')); assert.deepEqual(readRequirements(roots, 'checkout'), valid);}
  put(roots, 'bad.json', '{'); assert.throws(() => importDecisions(roots, 'checkout', 'bad.json')); assert.deepEqual(readRequirements(roots, 'checkout'), valid);
});

test('accepted rules require current source criteria or explicit recorded owner decisions', async () => {
  const roots = fixture(), source = await captureRequirements(roots, local());
  let state = prepareRequirements(roots, 'checkout', source), entry = state.inventory[0];
  const request = evidence => ({version: 1, snapshot: state.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence}]});
  assert.throws(() => updateInventory(roots, 'checkout', request([])), /evidence/);
  assert.throws(() => updateInventory(roots, 'checkout', request([{kind: 'finding', id: 'latency', status: 'approved'}])), /Finding/);
  assert.throws(() => updateInventory(roots, 'checkout', request([{kind: 'source', partId: entry.partId, revision: entry.revision, quote: source.parts[0].text}])), /criterion/);
  const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: state.consumer, snapshot: state.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: 'Names allow spaces & special characters.'};
  put(roots, 'owner.json', decision);
  state = updateInventory(roots, 'checkout', request([{kind: 'decision', path: 'owner.json', fingerprint: fingerprint(decision)}]));
  assert.equal(state.inventory[0].disposition, 'accepted'); assert.equal(state.inventory[1].disposition, 'unknown');
  put(roots, 'story.md', 'Names allow spaces & special characters.\nResponse time is now below 2 seconds.\n');
  state = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  assert.equal(state.inventory[0].disposition, 'unknown');
  assert.throws(() => updateInventory(roots, 'checkout', request([{kind: 'decision', path: 'owner.json', fingerprint: fingerprint(decision)}])), /current explicit/);
});

test('source refresh retains manual exports and exposes stale planning references without analysis', async () => {
  const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const state = bindSyntheticReview(roots), decisions = nativeDecisions(state); put(roots, 'export.json', decisions);
  const imported = importDecisions(roots, 'checkout', 'export.json'), plan = planningHandoff(roots, 'checkout');
  put(roots, 'story.md', 'A changed rule with the same line identity.\nResponse time is unspecified.\n');
  const changed = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  assert.equal(changed.review, null); assert.equal(changed.priorReviews[0].handoff.sha256, imported.review.handoff.sha256);
  assert.equal(readReviewHandoff(roots, changed, changed.priorReviews[0]).comment, decisions.comment);
  assert.equal(planningHandoff(roots, 'checkout', plan).staleReferences, true);
  assert.equal(changed.analysisInvocations, 1);
});

test('missing dependency and changed-content upgrade attempts preserve prepared/prior state', async () => {
  const roots = fixture(); const before = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  assert.throws(() => startRequirementsReview(roots, 'checkout', {findings: [], gapcue: join(roots.projectRoot, 'absent')}), /incompatible/);
  const directory = join(roots.projectRoot, 'different-version');
  for (const name of Object.keys(GAPCUE.files)) put(roots, 'different-version/' + name, name === 'SKILL.md' ? 'metadata:\n  version: "0.4.0"' : 'changed');
  assert.throws(() => resolveGapCue(directory), /incompatible/); assert.deepEqual(readRequirements(roots, 'checkout'), before);
});

test('sanitization preserves allowed characters and explicitly omits unsupported/inaccessible sources', async () => {
  const roots = fixture(); put(roots, 'secret.md', ['password', 'super-secret-synthetic-value'].join('=') + '\nNames allow spaces & special characters.');
  const request = {...local(), sources: [{id: 'notes', kind: 'file', path: 'secret.md'}, {id: 'image', kind: 'file', path: 'missing.png'}]};
  const source = await captureRequirements(roots, request);
  assert.equal(source.parts.length, 1); assert.match(source.parts[0].text, /spaces & special/); assert(source.omissions.length >= 2);
  assert(!JSON.stringify(source).includes('super-secret-synthetic-value'));
  assert.deepEqual(validateFindings([], []), []);
});

test('reused finding IDs with changed meaning show differences and cannot carry approval', async () => {
  const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const first = bindSyntheticReview(roots), original = nativeDecisions(first); put(roots, 'export.json', original); importDecisions(roots, 'checkout', 'export.json');
  put(roots, 'story.md', 'Names must now follow an explicitly revised display rule.\nResponse time is unspecified.');
  prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  bindSyntheticReview(roots, 'checkout', ['latency'], {latency: {why: 'A different business rule now conflicts with display behavior.', q: 'Which revised display rule is accepted?'}});
  const diff = reviewDifferences(roots, readRequirements(roots, 'checkout'));
  assert(diff.changedFindingIds.includes('latency')); assert(diff.affectedFindingIds.includes('latency')); assert.deepEqual(diff.carriedDecisions, []); assert.equal(diff.previousComment, original.comment);
  assert.throws(() => importDecisions(roots, 'checkout', 'export.json'), /identity/);
});

test('project/application and consumer identities cannot share an analysis accidentally', async () => {
  const roots = fixture(), another = fixture(), source = await captureRequirements(roots, local());
  const before = prepareRequirements(roots, 'checkout', source);
  assert.throws(() => prepareRequirements(another, 'checkout', source), /consumer/);
  const different = await captureRequirements(roots, {...local(), application: 'another-application'});
  assert.throws(() => prepareRequirements(roots, 'checkout', different), /another project/); assert.deepEqual(readRequirements(roots, 'checkout'), before);
});

test('native markdown questions preserve literal comparison operators and special characters', async () => {
  const roots = fixture(), state = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const findings = [{id: 'range', kind: 'gap', title: 'Range', why: 'Accepted range is unspecified.', q: 'Should values < 100 or > 200 be rejected, and is <Admin> allowed?', anchors: [], requirementIds: [state.inventory[0].id]}];
  assert.equal(validateFindings(findings, state.inventory)[0].q, findings[0].q);
});

test('saved custom findings and edited questions remain visible during refresh reassessment', async () => {
  const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  const state = bindSyntheticReview(roots), decisions = nativeDecisions(state);
  decisions.custom.push({id: 'own-1', kind: 'gap', q: 'Which seed data is available?', title: 'Data', anchors: []});
  put(roots, 'custom.json', decisions); importDecisions(roots, 'checkout', 'custom.json');
  put(roots, 'story.md', 'A changed display rule.\nResponse time is unspecified.'); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local())); bindSyntheticReview(roots);
  const differences = reviewDifferences(roots, readRequirements(roots, 'checkout'));
  assert(differences.changedFindingIds.includes('own-1')); assert.equal(differences.beforeFindings.find(finding => finding.id === 'latency').q, decisions.qEdit.latency);
  assert(differences.beforeFindings.some(finding => finding.id === 'own-1')); assert.equal(differences.previousComment, decisions.comment);
});

test('modified native input or page cannot masquerade as the bound reviewed content', async () => {
  for (const target of ['input', 'page']) {
    const roots = fixture(); prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
    const state = bindSyntheticReview(roots), decisions = nativeDecisions(state); put(roots, 'native.json', decisions);
    const valid = importDecisions(roots, 'checkout', 'native.json');
    if (target === 'input') {const changed = JSON.parse(readFileSync(join(roots.projectRoot, state.review.input))); changed.findings[0].q = 'Another meaning'; put(roots, state.review.input, changed);}
    else put(roots, `${state.review.root}/${state.review.storyId}/v1/index.html`, '<p>A replaced native page.</p>');
    assert.throws(() => readReviewHandoff(roots, valid), /input|content changed/); assert.throws(() => importDecisions(roots, 'checkout', 'native.json'));
    assert.equal(readRequirements(roots, 'checkout').head, valid.head);
  }
});
