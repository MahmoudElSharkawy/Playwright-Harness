import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAdoClient, AdoError} from '../scripts/lib/integrations/ado-client.mjs';
import {loadBugSchema, inspectBugFields} from '../scripts/lib/integrations/bug-fields.mjs';
import {caseCapabilities} from '../scripts/lib/integrations/ado-case-design.mjs';
import {adoFixture} from './fixtures/ado.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {fixture} from './fixtures/execution-core.mjs';
import {prepareBugReport, previewBugReport, approveBugReport, fileBugReport} from '../scripts/lib/bug-report/index.mjs';
import {previewDesign, publishDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {deliverExecution} from '../scripts/lib/execute/delivery.mjs';

const title = {referenceName: 'System.Title', type: 'string', alwaysRequired: true};
const missingField = name => ({message: `TF51535: Cannot find field ${name}.`});
const deniedTags = {message: 'TF401289: The current user does not have permissions to create tags.'};
const configuration = {organizationUrl: 'https://ado.example.test/collection', project: 'another project', credentialRef: 'ADO_TEST_CREDENTIAL', bugs: {workItemType: 'Défaut'}};
const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
function metadataClient(fields, {missing = 'System.IterationLevel7', status = 404, error = missingField(missing), details = {}} = {}) {
  const requests = [];
  const client = createAdoClient({configuration, resolveCredential: () => 'synthetic-credential', fetchImpl: async (url, init) => {
    requests.push({url, ...init});
    if (url.includes('/workitemtypes/')) return response(url.includes('/states?') ? {value: [{name: 'Ouvert', category: 'Proposed'}]} : {value: fields});
    if (url.includes('/wit/fields?')) return response({value: fields.filter(field => field.referenceName !== missing).map(field => ({readOnly: false, ...field, ...details[field.referenceName]}))});
    if (url.includes('/wit/tags?')) return response({value: []});
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if (name === missing) return response(error, status);
    return response({readOnly: false, ...fields.find(field => field.referenceName === name), ...details[name]});
  }});
  return {client, requests};
}
const mutations = f => f.state.requests.filter(row => row.method !== 'GET' && !['wit/wiql', 'wit/workitemsbatch'].includes(row.path) && !row.query.includes('validateOnly=true'));

test('derived detail TF51535 and absent global entries retain metadata without guessed types in both workflows', async () => {
  for (const referenceName of ['System.IterationLevel7', 'System.AreaLevel2']) {
    const fields = [title, {referenceName, alwaysRequired: true, defaultValue: null}];
    const {client, requests} = metadataClient(fields, {missing: referenceName});
    const bug = await loadBugSchema(client), cases = await caseCapabilities(client, 'Cas localisé', {write: false});
    for (const schema of [bug, {fields: cases}]) {
      const derived = schema.fields.find(field => field.referenceName === referenceName);
      assert(derived.metadataUnavailable); assert.equal(derived.alwaysRequired, true); assert(!Object.hasOwn(derived, 'type'));
      assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic issue'}).ready, true);
      assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic issue', [referenceName]: 'supplied'}).ready, false);
    }
    assert(requests.every(row => row.method === 'GET'));
  }
});

test('missing custom/unknown metadata and unrelated failures never use the derived-field fallback', async () => {
  for (const name of ['Acme.Required', 'System.Unknown', 'System.IterationLevel70']) {
    const {client} = metadataClient([title, {referenceName: name, alwaysRequired: true}], {missing: name});
    await assert.rejects(loadBugSchema(client));
    await assert.rejects(caseCapabilities(client, 'Case', {write: false}));
  }
  for (const [status, error] of [[404, {}], [404, missingField('System.Other')], [401, {}], [403, deniedTags], [429, {}], [500, missingField('System.IterationLevel7')]]) {
    const {client} = metadataClient([title, {referenceName: 'System.IterationLevel7'}], {status, error});
    await assert.rejects(loadBugSchema(client), e => e instanceof AdoError && e.status === status);
  }
});

test('serialized metadata errors never retain an unrelated secret reflected as a field name', async () => {
  const credential = 'F' + randomUUID().replaceAll('-', '');
  const client = createAdoClient({configuration, resolveCredential: () => credential, fetchImpl: async () => response(missingField(credential), 404)});
  await assert.rejects(client.read('wit/fields/System.IterationLevel7?api-version=7.1'), error => {
    assert.equal(error.adoCode, 'TF51535'); assert.equal(error.fieldReference, undefined);
    assert(!error.message.includes(credential)); assert(!JSON.stringify(error).includes(credential)); return true;
  });
});

test('typed bug fields still honor global restrictions and optional null defaults are absent', async () => {
  const {client} = metadataClient([title, {referenceName: 'Acme.Optional', type: 'integer', defaultValue: null}, {referenceName: 'Acme.Generated', type: 'string', readOnly: false}], {details: {'Acme.Generated': {readOnly: true}}});
  const schema = await loadBugSchema(client);
  assert(schema.fields.find(field => field.referenceName === 'Acme.Generated').readOnly);
  assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic issue'}).ready, true);
  for (const values of [{'Acme.Optional': null}, {'Acme.Optional': 'bad'}, {'Acme.Generated': 'value'}, {'Acme.Unknown': 0}]) assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic issue', ...values}).ready, false);
  schema.fields.find(field => field.referenceName === 'Acme.Optional').alwaysRequired = true;
  assert(inspectBugFields(schema, {'System.Title': 'Synthetic issue'}).problems.some(row => row.code === 'required'));
});

test('required bug values retain false, zero and explicitly permitted empty strings', () => {
  const schema = {fields: [title, {referenceName: 'Acme.Flag', type: 'boolean', alwaysRequired: true}, {referenceName: 'Acme.Count', type: 'integer', alwaysRequired: true}, {referenceName: 'Acme.Empty', type: 'string', alwaysRequired: true, allowedValues: ['']}]};
  const values = {'System.Title': 'Synthetic issue', 'Acme.Flag': false, 'Acme.Count': 0, 'Acme.Empty': ''};
  assert.equal(inspectBugFields(schema, values).ready, true);
  schema.fields.at(-1).allowedValues = ['other'];
  assert.equal(inspectBugFields(schema, values).ready, false);
});

test('global discovery refuses partial pages, duplicate fields and unknown writability', async () => {
  for (const global of [{count: 2, value: [title]}, {value: [title, title]}, {value: [title]}]) {
    const client = createAdoClient({configuration, resolveCredential: () => 'synthetic-credential', fetchImpl: async url => response(url.includes('/workitemtypes/') ? {value: [title, {referenceName: 'System.IterationLevel7'}]} : global)});
    await assert.rejects(caseCapabilities(client, 'Case', {write: false}), /count|incomplete|duplicated|writability/);
  }
});

test('tag permission diagnostics are safe, fresh validation keeps tags, and no ordinary write is attempted', async () => {
  let deny = false; const attempts = [], credential = randomUUID();
  const client = createAdoClient({configuration, resolveCredential: () => credential, fetchImpl: async (url, init) => {
    attempts.push({url, ...init});
    return response(deny ? {...deniedTags, secret: credential, detail: 'Authorization: private'} : {fields: {}}, deny ? 403 : 200);
  }});
  const body = [{op: 'add', path: '/fields/System.Tags', value: 'fingerprint; harness-filing-synthetic'}];
  await client.validateWorkItem('Défaut', body);
  deny = true;
  for (let i = 0; i < 2; i++) await assert.rejects(client.validateWorkItem('Défaut', body, {fresh: true}), error => {
    assert.equal(error.status, 403); assert.equal(error.code, 'authentication-rejected'); assert.equal(error.adoCode, 'TF401289');
    assert.match(error.message, /Create tag definition/); assert.match(error.message, /access level/i);
    assert(!error.message.includes(credential)); assert(!error.message.includes('Authorization')); return true;
  });
  deny = false; await client.validateWorkItem('Défaut', body, {fresh: true});
  assert.equal(attempts.length, 4);
  assert(attempts.every(row => row.url.includes('validateOnly=true') && !row.url.includes('bypassRules') && row.body === JSON.stringify(body)));
});

test('bad error bodies preserve HTTP status and durable delivery certainty', async t => {
  const f = fixture(t);
  for (const status of [403, 503]) for (const kind of ['non-json', 'oversized', 'interrupted']) {
    const client = createAdoClient({configuration, roots: f.roots, resolveCredential: () => 'synthetic-credential', fetchImpl: async () => {
      if (kind === 'interrupted') return new Response(new ReadableStream({start(controller) {controller.error(new Error('private body failure'));}}), {status});
      return new Response(kind === 'non-json' ? 'private <html>' : 'x'.repeat(20000), {status});
    }});
    await assert.rejects(client.validateWorkItem('Défaut', []), error => error.status === status && !error.message.includes('private'));
    const delivery = client.delivery('bugs', true);
    await assert.rejects(delivery.write('create-bug', 'wit/workitems/$Bug?api-version=7.1', [], {method: 'POST', patch: true}), error => error.delivery.effect === (status === 403 ? 'not-executed' : 'uncertain'));
  }
});

test('case previews handle derived metadata, null defaults and IDs with no publication', async t => {
  const f = await adoDesignFixture(t), fault = f.state.fault;
  f.control.fields.push({referenceName: 'System.IterationLevel7', alwaysRequired: true, defaultValue: null, readOnly: true});
  f.control.fields.push({referenceName: 'Acme.Optional', type: 'integer', defaultValue: null, readOnly: false});
  f.state.fault = context => {
    if (context.path === 'wit/fields') {context.send({value: f.control.fields.filter(row => row.referenceName !== 'System.IterationLevel7')}); return true;}
    return fault(context);
  };
  const preview = await previewDesign(f.roots, 'login', {client: f.client});
  assert.equal(preview.operations.length, 2);
  for (const op of preview.operations) assert(!op.request.body.some(row => /\/fields\/System\.(AreaId|IterationId|IterationLevel7)$/.test(row.path)));
  assert(f.state.requests.some(row => row.method === 'POST' && row.query.includes('validateOnly=true')));
  assert(f.state.requests.some(row => row.method === 'PATCH' && row.query.includes('validateOnly=true') && row.body[0].path === '/rev'));
  assert.equal(mutations(f).length, 0);
});

test('case validation must return required writable values, even on HTTP success', async t => {
  const f = await adoDesignFixture(t), fault = f.state.fault;
  f.control.fields.push({referenceName: 'Acme.Required', type: 'integer', alwaysRequired: true, readOnly: false, defaultValue: null});
  f.state.fault = context => {
    if (context.url.searchParams.get('validateOnly') === 'true') {context.send({fields: Object.fromEntries(context.body.filter(row => row.path.startsWith('/fields/')).map(row => [row.path.slice(8), row.value]))}); return true;}
    return fault(context);
  };
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']}), /Acme.Required/);
  assert.equal(mutations(f).length, 0);
});

test('case permission revocation blocks the full marker-free approved create and update', async t => {
  for (const selected of [['NEW-01'], ['101']]) {
    const f = await adoDesignFixture(t), fault = f.state.fault;
    const preview = await previewDesign(f.roots, 'login', {client: f.client, selected}); let deny = true;
    f.state.fault = context => {
      if (deny && context.url.searchParams.get('validateOnly') === 'true') {context.send(deniedTags, 403); return true;}
      return fault(context);
    };
    await assert.rejects(publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint}), /TF401289.*Create tag definition/);
    await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected}), /TF401289/);
    assert.equal(mutations(f).length, 0);
    const validation = f.state.requests.filter(row => row.query.includes('validateOnly=true')).at(-1);
    assert.deepEqual(validation.body, preview.operations[0].request.body);
    assert(!validation.body.some(row => ['/fields/System.History', '/fields/System.Tags'].includes(row.path)));
    assert(validation.body.some(row => row.path === '/fields/Microsoft.VSTS.TCM.Steps'));
    deny = false; await previewDesign(f.roots, 'login', {client: f.client, selected});
    assert.equal(mutations(f).length, 0);
  }
});

test('dispatch-time case rejection retains sanitized permission guidance and a non-executed receipt', async t => {
  const f = await adoDesignFixture(t), fault = f.state.fault;
  const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']});
  f.state.fault = context => {
    if (context.path === 'wit/workitems/$test%20case' && context.url.searchParams.get('validateOnly') !== 'true') {context.send(deniedTags, 403); return true;}
    return fault(context);
  };
  const result = await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint});
  assert.equal(result.outcomes[0].status, 'failed');
  assert.match(result.outcomes[0].reason, /TF401289.*Create tag definition/);
  assert.equal(f.control.writes, 0);
  assert(f.receipts().flat().some(event => event.event === 'incomplete' && event.effect === 'not-executed'));
});

test('bug report permission revocation remains actionable and blocked before creation or evidence uploads', async t => {
  const f = await adoFixture(t), dependencies = {client: f.client, inventory: async () => [{pid: process.pid, identity: '1'}]};
  prepareBugReport(f.roots, 'permission', {version: 1, description: 'Synthetic failure', source: {content: 'The operation must succeed.', expected: 'Success'}, draft: {title: 'Synthetic operation fails', prerequisites: ['A record exists'], steps: ['Run the operation'], expected: 'Success', actual: 'Failure', fields: {'System.Tags': 'team-reviewed'}}, confirmation: {user: 'confirmed', agent: 'not-run'}, evidence: []});
  const preview = await previewBugReport(f.roots, 'permission', dependencies); assert(preview.ready); approveBugReport(f.roots, 'permission', preview.hash);
  let deny = true;
  f.state.fault = ({path, url, send}) => {
    if (path === 'wit/workitemtypes/bug/fields') {
      const fields = f.state.fieldDefinitions.filter(row => !['System.IterationLevel7', 'Acme.Optional'].includes(row.referenceName));
      send({value: [...fields, {referenceName: 'System.IterationLevel7', alwaysRequired: true}, {referenceName: 'Acme.Optional', type: 'integer', defaultValue: null}]}); return true;
    }
    if (path === 'wit/fields/system.iterationlevel7') {send(missingField('System.IterationLevel7'), 404); return true;}
    if (deny && url.searchParams.get('validateOnly') === 'true') {send(deniedTags, 403); return true;}
  };
  await assert.rejects(fileBugReport(f.roots, 'permission', preview.hash, dependencies), /TF401289.*Create tag definition/);
  const blocked = await previewBugReport(f.roots, 'permission', dependencies); assert(!blocked.ready); assert.match(JSON.stringify(blocked.problems), /TF401289/);
  const validation = f.state.requests.filter(row => row.query.includes('validateOnly=true')).at(-1);
  assert.deepEqual(Object.fromEntries(validation.body.filter(row => row.path.startsWith('/fields/')).map(row => [row.path.slice(8), row.value])), preview.bugs[0].fields);
  assert(validation.body.some(row => row.path === '/fields/System.Tags' && row.value === 'team-reviewed'));
  assert.equal(mutations(f).length, 0); assert.equal(f.state.attachments.size, 0);
  deny = false; assert((await previewBugReport(f.roots, 'permission', dependencies)).ready);
  assert.equal(mutations(f).length, 0);
});

test('execution-result bug filing uses the same full-payload permission block', async t => {
  const ado = await adoFixture(t, {bugs: {tags: ['team-reviewed']}}), f = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  f.apiStep(); f.freeze(); await executeApi(f);
  const dependencies = {client: ado.client, inventory: async () => [{pid: process.pid, identity: '1'}]};
  ado.state.fault = ({url, send}) => {if (url.searchParams.get('validateOnly') === 'true') {send(deniedTags, 403); return true;}};
  await assert.rejects(deliverExecution(f.roots, f.executionId, 'file-bugs', {}, dependencies), /TF401289.*Create tag definition/);
  const validation = ado.state.requests.filter(row => row.query.includes('validateOnly=true')).at(-1);
  assert(validation.body.some(row => row.path === '/fields/System.Tags' && row.value === 'team-reviewed'));
  assert.equal(mutations(ado).length, 0);
});
