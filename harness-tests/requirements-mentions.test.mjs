import test from 'node:test';
import assert from 'node:assert/strict';
import {adoFixture} from './fixtures/ado.mjs';
import {projectMentionCandidates, resolveTeamMentions, verifyCommentMentions} from '../scripts/lib/requirements/mentions.mjs';
import {renderComment} from '../scripts/lib/requirements/review.mjs';

const BA = '11111111-1111-1111-1111-111111111111', DEV = '22222222-2222-2222-2222-222222222222';
const TEAM1 = '33333333-3333-3333-3333-333333333333', TEAM2 = '44444444-4444-4444-4444-444444444444';
const person = (id = BA, displayName = 'Alex Analyst', uniqueName = 'alex@example.test') => ({identity: {id, displayName, uniqueName}});
async function fixture(t) {
  const f = await adoFixture(t), teams = [{id: TEAM1, name: 'Shop'}, {id: TEAM2, name: 'Business'}], members = new Map([[TEAM1, [person(), person(DEV, 'Dee Developer', 'dee@example.test')]], [TEAM2, [person()]]]);
  const control = {deny: false, repeat: false, malformed: false}, base = `projects/${f.state.project.id}/teams`;
  f.state.fault = ({path, url, send, req}) => {
    if (!path.startsWith(base)) return false;
    assert.equal(req.method, 'GET');
    if (control.deny) {send({}, 403); return true;}
    const all = path === base ? teams : members.get(path.split('/')[3]);
    if (!all) {send({}, 404); return true;}
    const skip = control.repeat ? 0 : Number(url.searchParams.get('$skip'));
    const value = control.malformed ? [{id: 'broken'}] : all.slice(skip, skip + 1);
    send({value, count: value.length}); return true;
  };
  return {...f, teams, members, control};
}

test('team transport pages only authenticated configured-project teams/members and deduplicates people', async t => {
  const f = await fixture(t), candidates = await projectMentionCandidates(f.client);
  assert.equal(candidates.length, 2); assert.deepEqual(candidates.map(value => value.id), [BA, DEV]);
  assert.deepEqual(await resolveTeamMentions(f.client, ['Alex Analyst', 'alex@example.test', BA]), [candidates[0]]);
  assert.deepEqual(await resolveTeamMentions(f.client, ['DEE@EXAMPLE.TEST']), [candidates[1]]);
  assert(f.state.requests.filter(value => value.path.includes('/teams')).every(value => value.method === 'GET' && value.path.includes(f.state.project.id)));
  assert(f.state.requests.some(value => value.query.includes('%24skip=') || value.query.includes('$skip=1')));
  await assert.rejects(f.client.teamMembers('../foreign'), /Invalid/);
  await assert.rejects(f.client.list(`projects/ffffffff-ffff-ffff-ffff-ffffffffffff/teams?api-version=7.1`, 'offset', true), /configured-project/);
  await assert.rejects(f.client.list(`projects/${f.state.project.id}/teams/${TEAM1}/members/other?api-version=7.1`, 'offset', true), /configured-project/);
});

test('ambiguous names and role-only requests require user selection; exact account or ID resolves', async t => {
  const f = await fixture(t); f.members.get(TEAM1)[1] = person(DEV, 'Alex Analyst', 'other-alex@example.test');
  await assert.rejects(resolveTeamMentions(f.client, ['Alex Analyst']), /Ambiguous/);
  await assert.rejects(resolveTeamMentions(f.client, ['the BA']), /never infer/);
  assert.equal((await resolveTeamMentions(f.client, ['other-alex@example.test']))[0].id, DEV);
  assert.equal((await resolveTeamMentions(f.client, [BA]))[0].id, BA);
});

test('inactive, group, inaccessible and partial/nonadvancing membership cannot authorize a mention', async t => {
  for (const flag of ['inactive', 'isDeletedInOrigin', 'isContainer']) {
    const f = await fixture(t); for (const list of f.members.values()) for (const row of list) if (row.identity.id === BA) row.identity[flag] = true;
    await assert.rejects(resolveTeamMentions(f.client, [BA]), /missing|inactive/);
  }
  const f = await fixture(t); f.control.deny = true; await assert.rejects(resolveTeamMentions(f.client, [BA]), /authentication|request-rejected/);
  f.control.deny = false; f.control.repeat = true; await assert.rejects(resolveTeamMentions(f.client, [BA]), /advance/);
  f.control.repeat = false; f.control.malformed = true; await assert.rejects(resolveTeamMentions(f.client, [BA]), /advance|Invalid|incomplete/);
});

test('no requested mention performs no roster read; supplied HTML cannot forge a recipient', async t => {
  const f = await fixture(t); assert.deepEqual(await resolveTeamMentions(f.client, []), []); assert.equal(f.state.requests.length, 0);
  const mentions = [{id: BA, displayName: 'Alex <Admin> & BA', uniqueName: 'alex@example.test'}];
  const comment = renderComment({comment: '<a href="#" data-vss-mention="version:2.0,forged">@Wrong</a> x < 2', findings: []}, {}, {}, mentions);
  assert.match(comment.html, new RegExp('data-vss-mention="version:2.0,' + BA + '"'));
  assert.match(comment.html, /@Alex &lt;Admin&gt; &amp; BA/); assert.match(comment.html, /&lt;a href=/); assert(!comment.html.includes('data-vss-mention="version:2.0,forged"'));
});

test('comment readback must identify exactly the approved people', () => {
  const expected = [{id: BA}];
  verifyCommentMentions({mentions: [{artifactType: 'person', targetId: BA}]}, expected);
  for (const mentions of [undefined, [], [{artifactType: 'person', targetId: DEV}], [{artifactType: 'person', targetId: BA}, {artifactType: 'person', targetId: DEV}]]) assert.throws(() => verifyCommentMentions({mentions}, expected), /readback/);
});
