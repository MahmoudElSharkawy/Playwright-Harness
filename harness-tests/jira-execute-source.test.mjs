import test from 'node:test';
import assert from 'node:assert/strict';
import {captureJiraExecution, jiraCasesToSource, checkJiraSourceRevisions} from '../scripts/lib/integrations/jira-source.mjs';
const client = {configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', testManagement: {provider: 'xray'}}, projectIdentity: async () => ({id: '10', key: 'DEMO', name: 'Demo'}), issue: async key => ({id: '1', key, fields: {summary: 'Save names', description: 'Names are preserved', updated: '2026-10-01T00:00:00Z', issuelinks: []}})};
const native = () => ({id: 'DEMO-42', nativeId: '1042', provider: 'xray', siteUrl: client.configuration.siteUrl, project: 'DEMO', title: 'Save a name', revision: '2026-10-01T00:00:00Z', fingerprint: 'a'.repeat(64), description: 'Names allow spaces.', preconditions: [{id: 'DEMO-12', text: 'An active account exists.'}], steps: [{id: 'step-a', action: 'Save the name', data: 'Full name: Sample User', expected: 'The name appears.'}], externalReferences: [{system: 'xray', id: 'https://example.atlassian.net/browse/DEMO-42'}]});
test('native Jira cases retain opaque identities, setup, data and expected results in the shared execution source', async () => {
  const management = {provider: 'xray', capabilities: {remoteCases: true}, storyCases: async () => [native()]};
  const source = await captureJiraExecution(client, management, {kind: 'story', id: 'DEMO-1'});
  assert.equal(source.scope.siteUrl, client.configuration.siteUrl); assert.equal(source.scope.selection.id, 'DEMO-1');
  assert.equal(source.cases[0].id, 'DEMO-42'); assert.equal(source.cases[0].revision, native().revision); assert.equal(source.cases[0].nativeFingerprint, native().fingerprint);
  assert(source.scenarios[0].steps.some(step => step.action.includes('active account'))); assert(source.scenarios[0].steps.some(step => step.action.includes('Full name')));
  assert.deepEqual(source.scenarios[0].steps.at(-1).expected, ['The name appears.']);
  assert.equal(source.scenarios[0].caseId, 'DEMO-42'); assert.equal(source.organizationUrl, undefined); assert.equal(source.cases[0].rev, undefined);
});
test('neutral source identities cannot collide between Jira sites or plugins', () => {
  const a = jiraCasesToSource([native()], {siteUrl: client.configuration.siteUrl, project: 'DEMO', testManagement: 'xray', selection: {kind: 'case', id: 'DEMO-42'}});
  const b = jiraCasesToSource([{...native(), siteUrl: 'https://example-other.atlassian.net'}], {siteUrl: 'https://example-other.atlassian.net', project: 'DEMO', testManagement: 'xray', selection: {kind: 'case', id: 'DEMO-42'}});
  assert.notEqual(a.id, b.id); assert.notEqual(a.scenarios[0].id, b.scenarios[0].id);
});
test('Jira freshness compares native content as well as updated revision; unavailable reads fail closed', async () => {
  const management = {provider: 'xray', capabilities: {remoteCases: true}, storyCases: async () => [native()], readCase: async () => native()};
  const source = await captureJiraExecution(client, management, {kind: 'story', id: 'DEMO-1'});
  assert.deepEqual(await checkJiraSourceRevisions(source, management, client), []);
  management.readCase = async () => ({...native(), fingerprint: 'b'.repeat(64)});
  assert.equal((await checkJiraSourceRevisions(source, management, client))[0].caseId, 'DEMO-42');
  management.readCase = async () => {throw Error('permission-denied');};
  await assert.rejects(checkJiraSourceRevisions(source, management, client), /permission-denied/);
});
test('no-plugin selection points to local case execution and never invokes a native test API', async () => {
  await assert.rejects(captureJiraExecution(client, {capabilities: {remoteCases: false}}, {kind: 'story', id: 'DEMO-1'}), /local/);
});
