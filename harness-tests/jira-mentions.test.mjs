import test from 'node:test';
import assert from 'node:assert/strict';
import {jiraMentionCandidates, resolveJiraMentions} from '../scripts/lib/integrations/jira-comments.mjs';

function clientFor({permission = true, pages = new Map()} = {}) {
  const reads = [];
  return {reads, configuration: {project: 'DEMO'}, projectIdentity: async () => ({id: '10', key: 'DEMO'}), async read(route) {
    reads.push(route);
    if (route.startsWith('mypermissions')) return {permissions: {USER_PICKER: {havePermission: permission}}};
    const query = new URL('https://fixture.test/' + route).searchParams;
    return pages.get(Number(query.get('startAt'))) ?? [];
  }};
}
const person = (accountId, overrides = {}) => ({accountId, displayName: 'Reviewer', active: true, accountType: 'atlassian', ...overrides});

test('Jira mentions reject permission-filtered empty directories', async () => {
  const client = clientFor({permission: false});
  await assert.rejects(jiraMentionCandidates(client), /permission/);
  assert.equal(client.reads.length, 1);
});

test('Jira mention selection crosses sparse ranges and binds exact active account IDs', async () => {
  const client = clientFor({pages: new Map([[200, [person('other'), person('chosen', {active: false})]], [400, [person('chosen')]]])});
  const selected = await resolveJiraMentions(client, ['chosen', 'chosen']);
  assert.equal(selected.length, 1); assert.equal(selected[0].id, 'chosen');
  assert.equal(client.reads.filter(route => route.startsWith('user/')).length, 5);
  assert(client.reads.filter(route => route.startsWith('user/')).every(route => route.includes('accountId=chosen')));
});

test('Jira mention directory states its bound and never guesses a matching display name', async () => {
  const client = clientFor({pages: new Map([[0, [person('other'), person('app', {accountType: 'app'})]]])});
  const candidates = await jiraMentionCandidates(client);
  assert.equal(candidates.complete, false); assert.deepEqual(candidates.candidates.map(row => row.id), ['other']);
  assert.equal(client.reads.filter(route => route.startsWith('user/')).length, 10);
  await assert.rejects(resolveJiraMentions(client, ['Reviewer']), /unresolved/);
});
