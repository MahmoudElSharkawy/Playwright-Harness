import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterNames, parseIterations, substitute, prepareSource, checkSourceRevisions} from '../scripts/lib/execute/source.mjs';
import {adoFixture, xml} from './fixtures/ado.mjs';
import {createAdoTestSource} from '../scripts/lib/integrations/ado-source.mjs';

test('ADO row values, declared substitutions and sensitive bindings preserve templates', () => {
  assert.deepEqual(parameterNames('<parameters><param name="A B"/><param name="AB"/></parameters>'), ['A B', 'AB']);
  assert.deepEqual(parseIterations('<NewDataSet><Table1><A_x0020_B> a &amp; b </A_x0020_B><empty/></Table1></NewDataSet>'), [{'A B': ' a & b ', empty: ''}]);
  assert.equal(substitute('@a @AB mail@a x.@a @@a', {a: 'short', AB: 'long'}), 'short long mail@a x.@a @@a');
  assert.equal(substitute('@long @short', {long: '@short', short: 'literal'}), '@short literal');
  const source = prepareSource({organizationUrl: 'https://ado.example.test', project: 'demo', suiteName: 'Rows', cases: [{id: 1, rev: 3, title: 'Case', parameters: '<parameters><param name="name"/><param name="password"/></parameters>', dataTableXml: '<NewDataSet><Table1><name>Alpha</name><password>private-value</password></Table1></NewDataSet>', steps: [{action: 'Enter @name and @password', expected: 'Name is @name'}]}]}, {kind: 'suite', planId: 1, suiteId: 2});
  assert.equal(source.scenarios[0].id, 'tc-1-r1'); assert.equal(source.scenarios[0].steps[0].actionTemplate, 'Enter @name and @password'); assert.equal(source.scenarios[0].steps[0].action, 'Enter Alpha and @password'); assert.deepEqual(source.scenarios[0].needsBinding, ['password']); assert(!JSON.stringify(source).includes('private-value'));
});
test('tolerant fetch excludes malformed cases, retains revisions, and default fetch stays strict', async t => {
  const f = await adoFixture(t); f.state.items.get(102).fields['Microsoft.VSTS.TCM.Steps'] = '<steps/>';
  const source = createAdoTestSource(f.client), fetched = await source.fetchSuite(1, 2, {tolerant: true});
  assert.deepEqual(fetched.cases.map(item => item.id), [101]); assert.deepEqual(fetched.excluded, [{id: 102, reason: 'no-steps'}]); assert.equal(fetched.cases[0].rev, 1);
  await assert.rejects(source.fetchSuite(1, 2), /absent/);
});

test('undeclared row columns cannot rewrite source literals; shared declarations can bind case-insensitively', () => {
  const source = prepareSource({organizationUrl: 'https://ado.example.test', project: 'demo', suiteName: 'Declared parameters', cases: [{id: 1, rev: 1, title: 'Case', parameters: '<parameters><param name="Expected"/></parameters>', sharedParameters: ['Shared'], dataTableXml: '<NewDataSet><Table1><Expected>Ready</Expected><Support>Unexpected substitution</Support><shared>Shared value</shared></Table1></NewDataSet>', steps: [{action: 'Inspect @Support and @Shared', expected: '@Expected and literal @Support'}]}]}, {kind: 'suite', planId: 1, suiteId: 2});
  assert.deepEqual(source.scenarios[0].bindings, {Expected: 'Ready', Shared: 'Shared value'});
  assert.equal(source.scenarios[0].steps[0].action, 'Inspect @Support and Shared value');
  assert.equal(source.scenarios[0].expectations[0].description, 'Ready and literal @Support');
});
test('revision recheck uses batches of at most 200 and flags shared-step dependents', async t => {
  const f = await adoFixture(t), cases = [];
  for (let id = 300; id < 705; id++) {f.state.items.set(id, {id, rev: 2, fields: {'System.TeamProject': 'demo', 'Microsoft.VSTS.TCM.Steps': xml()}}); cases.push({id, rev: 2, sharedIds: [101]});}
  const changed = await checkSourceRevisions({cases, sharedSteps: {101: 0}}, createAdoTestSource(f.client)); assert.equal(changed.length, 405);
  const batches = f.state.requests.filter(request => request.path === 'wit/workitemsbatch'); assert.equal(batches.length, 3); assert(batches.every(request => request.body.ids.length <= 200));
});
