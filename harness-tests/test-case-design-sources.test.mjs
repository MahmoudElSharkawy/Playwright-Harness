import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, readRequirementsSource} from '../scripts/lib/requirements/index.mjs';
import {prepareDesign} from '../scripts/lib/test-case-design/index.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';

test('reordering accepted source statements preserves their identities without carrying acceptance', async () => {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-design-source-'))), request = {version: 1, project: 'demo', application: 'login', sources: [{id: 'story', kind: 'file', path: 'story.md'}]};
  const sentences = ['Sign in opens the current user dashboard.', 'Incorrect passwords leave the user signed out.', 'Arabic labels use RTL.']; put(roots, 'story.md', sentences.join('\n'));
  const before = prepareRequirements(roots, 'login', await captureRequirements(roots, request)), source = readRequirementsSource(roots, before);
  const identities = Object.fromEntries(before.inventory.map(entry => [source.parts.find(part => part.id === entry.partId).text.slice(entry.start, entry.end), entry.id]));
  put(roots, 'story.md', [sentences[2], sentences[0], sentences[1]].join('\n'));
  const after = prepareRequirements(roots, 'login', await captureRequirements(roots, request)), changed = readRequirementsSource(roots, after);
  for (const entry of after.inventory) assert.equal(entry.id, identities[changed.parts.find(part => part.id === entry.partId).text.slice(entry.start, entry.end)]);
  assert(after.inventory.every(entry => entry.disposition !== 'accepted'));
});

test('design reads no unselected attachments or neighboring story bodies, while missing context stays explicit', async t => {
  const f = await adoDesignFixture(t), attachmentId = 'aaaaaaaa-1111-2222-3333-444444444444';
  f.state.items.get(200).relations.push({rel: 'AttachedFile', url: `${f.config.organizationUrl}/_apis/wit/attachments/${attachmentId}`, attributes: {name: 'hostile.md'}}, {rel: 'System.LinkTypes.Related', url: `${f.config.organizationUrl}/_apis/wit/workitems/999`});
  const state = await prepareDesign(f.roots, 'new-selection', {version: 1, analysisId: 'selected', request: {version: 1, project: 'demo', application: 'login', storyId: 200, sources: []}, context: {id: 'missing', query: 'Arabic login'}}, {client: f.client});
  assert.equal(state.evidence.existing.length, 0); assert.equal(state.evidence.context.unavailable, true); assert(state.evidence.related.some(row => row.id === 999));
  assert(state.evidence.requirements.omissions.some(row => row.sourceId.endsWith(attachmentId) && row.reason === 'not-selected'));
  assert(!f.state.requests.some(row => row.path.includes('/attachments/') || row.path === 'wit/workitems/999'));
  assert(f.state.requests.some(row => row.path === 'wit/workitems/200/revisions'));
});
