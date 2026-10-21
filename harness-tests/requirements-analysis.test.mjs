import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, readRequirements, planningHandoff, updateInventory} from '../scripts/lib/requirements/index.mjs';
import {validateFindings} from '../scripts/lib/requirements/review.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';

const local = () => ({version: 1, project: 'synthetic-shop', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]});
const fixture = () => {const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-requirements-'))); put(roots, 'story.md', 'Names allow spaces & special characters.\nResponse time is unspecified.\n'); return roots;};

test('local capture produces one stable inventory with unresolved acceptance and planning references', async () => {
  const roots = fixture(), source = await captureRequirements(roots, local()), result = prepareRequirements(roots, 'checkout', source);
  assert.equal(result.inventory.length, 2); assert(result.inventory.every(item => item.disposition === 'unknown' && item.evidence.length === 0));
  const plan = planningHandoff(roots, 'checkout');
  assert.deepEqual(plan.requirements.map(item => item.id), result.inventory.map(item => item.id)); assert.equal(plan.inventory, result.inventoryPath);
  assert.equal(plan.analysisInvocations, 0); assert.equal(readRequirements(roots, 'checkout').snapshot, source.fingerprint);
});

test('changed source invalidates downstream references while preserving stable IDs', async () => {
  const roots = fixture(), before = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local())), plan = planningHandoff(roots, 'checkout');
  put(roots, 'story.md', 'Names allow spaces & special characters.\nResponse time is below 2 seconds.\n');
  const after = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  assert.deepEqual(after.inventory.map(item => item.id), before.inventory.map(item => item.id)); assert.notEqual(plan.snapshot, after.snapshot);
  assert(after.inventory.every(item => item.disposition !== 'accepted')); assert(after.staleRequirementIds.includes(after.inventory[1].id));
  assert.equal(planningHandoff(roots, 'checkout', plan).staleReferences, true); assert.equal(after.analysisInvocations, 0);
});

test('accepted rules require current source criteria or explicit recorded owner decisions', async () => {
  const roots = fixture(), source = await captureRequirements(roots, local());
  let state = prepareRequirements(roots, 'checkout', source), entry = state.inventory[0];
  const request = evidence => ({version: 1, snapshot: state.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence}]});
  assert.throws(() => updateInventory(roots, 'checkout', request([])), /evidence/);
  assert.throws(() => updateInventory(roots, 'checkout', request([{kind: 'finding', id: 'F-01', status: 'approved'}])), /Finding/);
  assert.throws(() => updateInventory(roots, 'checkout', request([{kind: 'source', partId: entry.partId, revision: entry.revision, quote: source.parts[0].text}])), /criterion/);
  const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: state.consumer, snapshot: state.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: source.parts[0].text};
  put(roots, 'owner.json', decision); state = updateInventory(roots, 'checkout', request([{kind: 'decision', path: 'owner.json', fingerprint: fingerprint(decision)}]));
  assert.equal(state.inventory[0].disposition, 'accepted'); assert.equal(state.inventory[1].disposition, 'unknown');
  put(roots, 'story.md', 'Names allow spaces & special characters.\nResponse time is now below 2 seconds.\n'); state = prepareRequirements(roots, 'checkout', await captureRequirements(roots, local()));
  assert.equal(state.inventory[0].disposition, 'unknown');
  assert.throws(() => updateInventory(roots, 'checkout', request([{kind: 'decision', path: 'owner.json', fingerprint: fingerprint(decision)}])), /current explicit/);
});

test('sanitization preserves allowed characters and explicitly omits unsupported/inaccessible sources', async () => {
  const roots = fixture(); put(roots, 'secret.md', ['password', 'super-secret-synthetic-value'].join('=') + '\nNames allow spaces & special characters.');
  const source = await captureRequirements(roots, {...local(), sources: [{id: 'notes', kind: 'file', path: 'secret.md'}, {id: 'image', kind: 'file', path: 'missing.png'}]});
  assert.equal(source.parts.length, 1); assert.match(source.parts[0].text, /spaces & special/); assert(source.omissions.length >= 2);
  assert(!JSON.stringify(source).includes('super-secret-synthetic-value')); assert.deepEqual(validateFindings([], [], source), []);
});

test('project/application and consumer identities cannot share an analysis accidentally', async () => {
  const roots = fixture(), another = fixture(), source = await captureRequirements(roots, local()), before = prepareRequirements(roots, 'checkout', source);
  assert.throws(() => prepareRequirements(another, 'checkout', source), /consumer/);
  const different = await captureRequirements(roots, {...local(), application: 'another-application'});
  assert.throws(() => prepareRequirements(roots, 'checkout', different), /another project/); assert.deepEqual(readRequirements(roots, 'checkout'), before);
});
