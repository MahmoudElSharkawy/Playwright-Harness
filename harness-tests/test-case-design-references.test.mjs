import test from 'node:test';
import assert from 'node:assert/strict';
import {adoFixture} from './fixtures/ado.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';
import {captureRequirements, prepareRequirements, updateInventory, readRequirementsSource} from '../scripts/lib/requirements/index.mjs';
import {prepareDesign} from '../scripts/lib/test-case-design/index.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';

const description = 'System.Description', criteria = 'Microsoft.VSTS.Common.AcceptanceCriteria';
async function fixture(t, text = 'Apply postcode validation from #1180.') {
  const f = await adoFixture(t);
  const item = (id, content) => ({id, rev: 1, fields: {'System.Title': `Rules ${id}`, 'System.TeamProject': 'demo', 'System.WorkItemType': 'User Story', [description]: '', [criteria]: content}, relations: []});
  f.state.items.set(1200, item(1200, text));
  f.state.items.set(1180, item(1180, 'Postcodes contain five digits. Preserve leading zeroes. Trim surrounding spaces.'));
  f.state.fault = ({path, send}) => {
    if (path === 'wit/workitemtypecategories/microsoft.testcasecategory') {send({referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{name: 'Test Case'}]}); return true;}
    if (path.endsWith('/comments')) {send({comments: []}); return true;}
    if (path.endsWith('/revisions')) {send({value: []}); return true;}
  };
  f.selection = {version: 1, analysisId: 'postcode', request: {version: 1, project: 'demo', application: 'checkout', storyId: 1200, sources: []}};
  f.prepare = (selection = f.selection) => prepareDesign(f.roots, 'postcode', selection, {client: f.client});
  return f;
}
const reference = state => state.evidence.references.items.find(row => row.workItemId === 1180);
const selectionFor = state => {
  const ref = reference(state), entry = state.requirements.inventory.find(row => row.kind === 'criterion');
  return {version: 1, analysisId: 'postcode', references: [{id: ref.id, classification: 'required', requirementIds: [entry.id], reason: 'Selected story delegates postcode validation.', rules: [{location: criteria, quote: ref.source.parts.find(row => row.location === criteria).text}]}]};
};
function accept(f, state) {
  const ref = reference(state), entry = state.requirements.inventory.find(row => row.kind === 'criterion');
  const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: state.consumer, snapshot: state.requirements.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: 'Use these exact captured postcode rules.', references: [{id: ref.id, revision: ref.revision, content: ref.content}]};
  put(f.roots, 'owner.json', decision);
  updateInventory(f.roots, 'postcode', {version: 1, snapshot: state.requirements.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path: 'owner.json', fingerprint: fingerprint(decision)}]}]});
}

test('capture preserves href provenance, single decoding and secret redaction without following links', async t => {
  const f = await fixture(t, '<p>Apply <a href="https://ado.example.test/collection/demo/_workitems/edit/1180">existing &amp;lt;rules&amp;gt;</a>.</p>');
  f.state.items.get(1200).fields[description] = '<a href="javascript:run()">unsupported</a><a href="https://example.test/rules?access_token=private-fixture-value">private link</a>';
  const captured = await captureRequirements(f.roots, f.selection.request, {client: f.client});
  const link = captured.links.find(row => row.location === criteria);
  assert.equal(link.text, 'existing &lt;rules&gt;'); assert.equal(link.destination, 'https://ado.example.test/collection/demo/_workitems/edit/1180');
  assert.equal(link.revision, '1'); assert.equal(link.sourceId, 'story'); assert(Number.isInteger(link.start));
  assert(captured.links.some(row => row.status === 'unsupported')); assert(captured.links.some(row => row.status === 'redacted'));
  assert(!JSON.stringify(captured).includes('private-fixture-value'));
  assert(!f.state.requests.some(row => row.path === 'wit/workitems/1180'));
});

test('direct IDs and hrefs deduplicate reads while preserving occurrences and incidental relations', async t => {
  const f = await fixture(t, '<p>Apply #1180 and <a href="https://ado.example.test/collection/demo/_workitems/edit/1180">existing rules</a>; see #1180. Use 1234 as data.</p>');
  f.state.items.get(1200).relations.push({rel: 'System.LinkTypes.Related', url: `${f.config.organizationUrl}/_apis/wit/workitems/999`});
  const state = await f.prepare(), ref = reference(state);
  assert.equal(ref.occurrences.length, 3); assert.equal(ref.classification, 'unresolved');
  assert.equal(f.state.requests.filter(row => row.path === 'wit/workitems/1180').length, 1);
  assert(!f.state.requests.some(row => /workitems\/(999|1234)$/.test(row.path)));
  assert.equal(state.evidence.references.items.find(row => row.workItemId === 999).classification, 'incidental');
  const {dependencyGaps} = await import('../scripts/lib/test-case-design/references.mjs');
  assert.equal(dependencyGaps(state).length, 1);
});

test('required rules use existing owner acceptance and relevant revision changes invalidate freshness', async t => {
  const f = await fixture(t), first = await f.prepare(), selection = selectionFor(first);
  let state = await f.prepare(selection);
  const {dependencyGaps, requireFreshReferences} = await import('../scripts/lib/test-case-design/references.mjs');
  assert.equal(reference(state).status, 'needs-decision'); assert.equal(dependencyGaps(state).length, 1);
  accept(f, state); state = await f.prepare(selection);
  assert.equal(reference(state).status, 'resolved'); assert.deepEqual(dependencyGaps(state), []);
  await requireFreshReferences(f.roots, state, {client: f.client});
  f.state.items.get(1180).rev++;
  await assert.rejects(requireFreshReferences(f.roots, state, {client: f.client}), /reference.*changed|referenced.*changed/i);
  assert.equal(f.state.items.get(1200).rev, 1);
  assert.equal(f.state.requests.filter(row => row.method !== 'GET').length, 0);
});

test('missing required references and deeper dependencies stay explicit without recursive reads', async t => {
  const f = await fixture(t);
  f.state.items.get(1180).fields[criteria] = 'Apply postcode rules from #1170.';
  let state = await f.prepare();
  assert(state.evidence.references.items.some(row => row.workItemId === 1170 && row.status === 'deeper-unresolved'));
  assert(!f.state.requests.some(row => row.path === 'wit/workitems/1170'));
  f.state.items.delete(1180); state = await f.prepare();
  assert.equal(reference(state).status, 'inaccessible');
});

test('cross-project and unsafe destinations never become reads and misleading anchor labels do not become IDs', async t => {
  const f = await fixture(t, '<p>Apply <a href="https://ado.example.test/collection/demo/_workitems/edit/1180">#999</a> and <a href="https://ado.example.test/collection/other/_workitems/edit/777">other rules</a>.</p>');
  const state = await f.prepare();
  assert(reference(state)); assert(state.evidence.references.items.some(row => row.status === 'out-of-scope'));
  assert(!f.state.requests.some(row => /workitems\/(999|777)$/.test(row.path)));
});

test('reference reads are bounded and new captures retain explicit provenance version', async t => {
  const f = await fixture(t, Array.from({length: 22}, (_, i) => `Apply #${1300 + i}.`).join(' '));
  const state = await f.prepare();
  assert.equal(state.evidence.references.reads, 20); assert.equal(state.evidence.references.items.filter(row => row.status === 'read-bound').length, 2);
  const snapshot = readRequirementsSource(f.roots, state.requirements);
  assert.equal(snapshot.linksVersion, 1);
});

test('legacy captures are explicit and cannot invent historical href provenance', async t => {
  const f = await fixture(t, '<a href="https://ado.example.test/collection/demo/_workitems/edit/1180">Apply existing postcode rules</a>');
  const captured = await captureRequirements(f.roots, f.selection.request, {client: f.client});
  const {links, linksVersion, fingerprint: oldHash, ...legacy} = captured;
  legacy.fingerprint = fingerprint(legacy);
  prepareRequirements(f.roots, 'postcode', legacy);
  const state = await f.prepare({version: 1, analysisId: 'postcode'});
  assert.equal(state.evidence.references.provenance, 'legacy-missing');
  assert.equal(state.evidence.references.items.length, 0);
  assert.equal(readRequirementsSource(f.roots, state.requirements).links, undefined);
  const {dependencyGaps} = await import('../scripts/lib/test-case-design/references.mjs');
  assert.equal(dependencyGaps(state)[0].status, 'legacy-missing');
});

test('selected rule excerpts exclude unrelated deeper references; explicit supplemental selection permits bounded resolution', async t => {
  const f = await fixture(t);
  f.state.items.get(1180).fields[criteria] = 'Postcodes contain five digits. Unrelated feature follows #1170.';
  let state = await f.prepare();
  const selection = selectionFor(state); selection.references[0].rules[0].quote = 'Postcodes contain five digits.';
  state = await f.prepare(selection);
  assert(!state.evidence.references.items.some(row => row.workItemId === 1170));
  f.state.items.get(1180).fields[criteria] = 'Apply postcode rules from #1170.';
  f.state.items.set(1170, {id: 1170, rev: 2, fields: {'System.TeamProject': 'demo', [criteria]: 'Postcodes contain five digits.'}});
  state = await f.prepare({version: 1, analysisId: 'postcode', referenceIds: [1170]});
  assert.equal(state.evidence.references.items.find(row => row.workItemId === 1170).revision, '2');
  assert.equal(state.evidence.references.reads, 2);
});

test('shared required references preserve per-requirement acceptance and unaffected selection freshness', async t => {
  const f = await fixture(t, 'Apply #1180 for saving. Apply #1180 for editing.');
  let state = await f.prepare(), part = state.evidence.requirements.parts.find(row => row.kind === 'criterion');
  const boundary = part.text.indexOf(' Apply') + 1;
  updateInventory(f.roots, 'postcode', {version: 1, snapshot: state.requirements.snapshot, partitions: [{partId: part.id, entries: [{id: 'saving', start: 0, end: boundary}, {id: 'editing', start: boundary, end: part.text.length}]}]});
  state = await f.prepare({version: 1, analysisId: 'postcode'});
  const selection = selectionFor(state); selection.references[0].requirementIds = ['saving', 'editing'];
  state = await f.prepare(selection); accept(f, state); state = await f.prepare(selection);
  const {dependencyGaps, requireFreshReferences} = await import('../scripts/lib/test-case-design/references.mjs');
  assert.deepEqual(dependencyGaps(state, ['saving']), []);
  assert.deepEqual(dependencyGaps(state, ['editing'])[0].requirementIds, ['editing']);
  state.draft = {cases: [{id: 'NEW-unrelated', coverageReferences: [{requirementId: 'another'}]}]};
  f.state.items.get(1180).rev++;
  await requireFreshReferences(f.roots, state, {client: f.client, selected: ['NEW-unrelated']});
  await assert.rejects(requireFreshReferences(f.roots, state, {client: f.client}), /changed/);
});

test('secret-bearing visible link URLs cannot leak through source text or retained story fields', async t => {
  const url = 'https://example.test/rules?access_token=' + 'private-fixture-value';
  const f = await fixture(t, `<a href="${url}">${url}</a>`);
  const state = await f.prepare();
  assert(!JSON.stringify(state).includes('private-fixture-value'));
  assert(state.evidence.references.items.some(row => row.status === 'redacted'));
});
