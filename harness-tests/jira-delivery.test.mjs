import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {createJiraClient} from '../scripts/lib/integrations/jira-client.mjs';

function setup(t, write) {
  const {roots} = fixture(t), calls = [];
  const client = createJiraClient({roots, configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'}, resolveEmail: () => 'qa@example.test', resolveCredential: () => 'synthetic',
    fetchImpl: async (url, options) => {
      if (url.endsWith('/myself')) return Response.json({accountId: 'account', active: true});
      if (url.endsWith('/project/DEMO')) return Response.json({id: '10', key: 'DEMO', name: 'Demo'});
      calls.push({url, options}); return write(url, options);
    }});
  return {roots, client, calls};
}
const events = (roots, delivery) => readFileSync(join(roots.projectRoot, delivery.receipt), 'utf8').trim().split('\n').map(line => JSON.parse(line));

test('Jira delivery flushes intent before dispatch and preserves opaque identities after local failure', async t => {
  let delivery;
  const f = setup(t, () => {
    assert.equal(events(f.roots, delivery).at(-1).event, 'dispatching');
    return Response.json({id: '9007199254740994', key: 'DEMO-1'});
  });
  delivery = f.client.delivery('story-comment', true, 'a'.repeat(64));
  await assert.rejects(delivery.write('create-comment', 'issue/DEMO-1/comment', {body: {}}, {method: 'POST', onIdentity() {throw Error('local callback');}}), /local callback/);
  const record = events(f.roots, delivery).at(-1);
  assert.equal(record.event, 'acknowledged'); assert.equal(record.effect, 'confirmed'); assert.equal(record.identity.commentId, '9007199254740994');
  delivery.verified({commentId: '9007199254740994'}); delivery.finish();
});

test('lost Jira mutation responses remain uncertain and cannot be replayed by the delivery', async t => {
  const f = setup(t, () => {throw Error('response lost');}), delivery = f.client.delivery('bugs', true);
  await assert.rejects(delivery.write('create-bug', 'issue', {fields: {}}, {method: 'POST'}), error => error.delivery?.effect === 'uncertain');
  await assert.rejects(delivery.write('create-bug', 'issue', {fields: {}}, {method: 'POST'}), /stopped/);
  assert.equal(f.calls.length, 1); assert.equal(events(f.roots, delivery).at(-1).effect, 'uncertain');
});

test('permission rejection is recorded as not executed and no-content updates can be verified', async t => {
  const denied = setup(t, () => Response.json({}, {status: 403})), delivery = denied.client.delivery('automation', true);
  await assert.rejects(delivery.write('set-automation', 'issue/DEMO-1/properties/harness', {}, {method: 'PUT'}), error => error.delivery?.effect === 'not-executed');
  const success = setup(t, () => new Response(null, {status: 204})), next = success.client.delivery('automation', true);
  assert.equal(await next.write('clear-automation', 'issue/DEMO-1/properties/harness', undefined, {method: 'DELETE'}), undefined);
  next.verified({testKey: 'DEMO-1'}); next.finish();
  assert.throws(() => success.client.delivery('automation', false), /authorization/);
});
