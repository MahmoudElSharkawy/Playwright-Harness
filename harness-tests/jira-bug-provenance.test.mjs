import test from 'node:test';
import assert from 'node:assert/strict';
import {prepared, recorded, put} from './fixtures/generation-report.mjs';
import {adoFixture} from './fixtures/ado.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {digest} from '../scripts/lib/execution-core/data.mjs';
import {jiraCasesToSource} from '../scripts/lib/integrations/jira-source.mjs';
import {jiraStoryRevision} from '../scripts/lib/integrations/jira-requirements.mjs';
import {reviewRunFailures} from '../scripts/lib/bug-report/failures.mjs';
import {prepareRunBugReports, previewBugReport, approveBugReport, fileBugReport} from '../scripts/lib/bug-report/index.mjs';

const inventory = async () => [{pid: process.pid, identity: '1'}];
async function automation(t, provider, snapshot = true) {
  const configuration = {siteUrl: 'https://example.atlassian.net', project: 'DEMO'}, story = {id: '10001', key: 'DEMO-1', fields: {summary: 'Accepted observation', updated: '2026-10-01T00:00:00Z', issuelinks: []}};
  const client = {configuration, issue: async () => structuredClone(story)};
  const tc = {id: provider === 'xray' ? 'DEMO-2' : 'DEMO-T2', nativeId: '10002', provider, ...configuration, revision: '2026-10-01T00:00:00Z', fingerprint: 'a'.repeat(64), title: 'Read observation', steps: [{id: 'step-a', action: 'Read observation', data: '', expected: 'Observation appears'}], externalReferences: [{system: provider, id: `${configuration.siteUrl}/browse/DEMO-2`}], raw: {selected: true}};
  const manifest = {provider: 'jira', ...configuration, projectId: '10000', testManagement: provider, selection: {kind: 'story', id: 'DEMO-1'}, story: {id: 'DEMO-1', version: jiraStoryRevision(client, story)}, cases: [tc]};
  manifest.sourceFingerprint = digest(JSON.stringify(manifest));
  const source = jiraCasesToSource(manifest.cases, manifest), f = await prepared(t, {source}); await recorded(f);
  put(f.roots.projectRoot, '.harness/original-jira.json', manifest);
  return {...f, manifest, tc, story, sourceClient: client, management: {provider, readCase: async () => structuredClone(tc)}, run: {workflow: 'automate-test', sourceId: source.id, ...(snapshot ? {jiraSnapshot: '.harness/original-jira.json'} : {})}};
}
async function drafts(f) {
  const review = await reviewRunFailures(f.roots, f.run);
  const input = {version: 1, run: f.run, hash: review.hash, classifications: review.findings.map(row => ({finding: row.id, classification: 'application', reason: 'Recorded assertion failed.', nextAction: 'Review source failure.'})), groups: [{members: review.findings.map(row => row.id), reason: 'One accepted observation failed.', draft: {title: 'Observation missing', description: 'Accepted observation does not appear.', steps: ['Read observation'], expected: 'Observation appears', actual: 'Observation missing', prerequisites: [], fields: {}}}]};
  return {review, result: await prepareRunBugReports(f.roots, 'jira-review', input, {inventory})};
}
for (const provider of ['xray', 'zephyr-scale']) test(`${provider}: automation binds original native case and story before filing to a separately selected tracker`, async t => {
  const f = await automation(t, provider), ado = await adoFixture(t), {review, result} = await drafts(f), id = result.drafts[0].reportId;
  assert.equal(review.findings[0].references[0].jira.cases[0].id, f.tc.id);
  const dependencies = {client: createAdoClient({configuration: ado.config, roots: f.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), sourceClient: f.sourceClient, management: f.management, inventory};
  const preview = await previewBugReport(f.roots, id, dependencies); assert(preview.ready, JSON.stringify(preview.problems)); approveBugReport(f.roots, id, preview.hash);
  f.tc.fingerprint = 'b'.repeat(64);
  await assert.rejects(fileBugReport(f.roots, id, preview.hash, dependencies), /Jira case or story changed/);
  f.tc.fingerprint = 'a'.repeat(64); f.story.fields.summary = 'Changed acceptance';
  await assert.rejects(fileBugReport(f.roots, id, preview.hash, dependencies), /Jira case or story changed/);
  assert.equal(ado.state.requests.filter(row => row.path === 'wit/workitems/$bug' && !row.query.includes('validateOnly=true')).length, 0);
});
test('native Jira automation without its selected original manifest stays editable but cannot file', async t => {
  const f = await automation(t, 'xray', false), {result} = await drafts(f);
  const preview = await previewBugReport(f.roots, result.drafts[0].reportId, {inventory});
  assert.equal(preview.ready, false); assert(preview.problems.some(row => row.code === 'missing-original-revisions'));
});
test('a changed Jira fetch manifest cannot substitute for the executed native case content', async t => {
  const f = await automation(t, 'xray'); f.manifest.cases[0].title = 'Substituted case'; put(f.roots.projectRoot, '.harness/original-jira.json', f.manifest);
  await assert.rejects(reviewRunFailures(f.roots, f.run), /snapshot|manifest/i);
});
