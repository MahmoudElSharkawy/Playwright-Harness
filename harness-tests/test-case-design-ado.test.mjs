import {retainAssessment} from './fixtures/design-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {readDesign, prepareDesign, saveDesign, assessDesign} from '../scripts/lib/test-case-design/index.mjs';
import {parseStepsXml} from '../scripts/lib/integrations/ado-steps.mjs';

const fieldChoices = (caseId, fields) => ({version: 1, cases: [{caseId, fields}]});
const extraField = (f, referenceName, type = 'string', options = {}) => f.control.fields.push({referenceName, name: referenceName, type, readOnly: false, ...options});

test('required managed metadata reaches validate-only and existing custom fields retain false zero and allowed empty', async t => {
  const f = await adoDesignFixture(t);
  extraField(f, 'Custom.Required', 'string', {alwaysRequired: true}); extraField(f, 'Custom.Enabled', 'boolean'); extraField(f, 'Custom.Count', 'integer'); extraField(f, 'Custom.Empty', 'string', {alwaysRequired: true, allowedValues: ['']});
  extraField(f, 'Custom.Calculated', 'integer', {alwaysRequired: true, readOnly: true});
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']}), /Custom.Required.*required|Required.*Custom.Required/i);
  const fields = {'Custom.Required': 'retail', 'Custom.Enabled': false, 'Custom.Count': 0, 'Custom.Empty': '', 'System.AreaPath': 'demo\\Catalog'};
  const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01'], fields: fieldChoices('NEW-01', fields)});
  assert.equal(f.control.writes, 0); assert(f.control.validations.length > 0);
  for (const [name, value] of Object.entries(fields)) assert.equal(preview.operations[0].fields[name], value);
  assert.deepEqual(Object.fromEntries(preview.fieldPreview[0].fields.filter(row => row.source !== 'server-default').map(row => [row.referenceName, row.value])), fields);
  assert(!preview.operations[0].request.body.some(row => ['/fields/System.AreaId', '/fields/System.IterationId'].includes(row.path)));
  const delivered = await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint});
  assert.equal(delivered.mode, 'completed'); for (const [name, value] of Object.entries(fields)) assert.equal(f.state.items.get(800).fields[name], value);
});

test('create defaults yield to reviewed per-case choices and do not overwrite existing update values', async t => {
  const f = await adoDesignFixture(t, {testCases: {fields: {'Custom.Team': 'default'}}}, {existingFields: {'Custom.Team': 'existing'}}); extraField(f, 'Custom.Team');
  const preview = await previewDesign(f.roots, 'login', {client: f.client, fields: fieldChoices('NEW-01', {'Custom.Team': 'override'})});
  assert.equal(preview.operations[0].fields['Custom.Team'], 'override');
  assert(!Object.hasOwn(preview.operations[1].fields, 'Custom.Team'));
  await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint});
  assert.equal(f.state.items.get(800).fields['Custom.Team'], 'override'); assert.equal(f.state.items.get(101).fields['Custom.Team'], 'existing');
  const defaults = await adoDesignFixture(t, {testCases: {fields: {'Custom.Team': 'default'}}}); extraField(defaults, 'Custom.Team');
  assert.equal((await previewDesign(defaults.roots, 'login', {client: defaults.client, selected: ['NEW-01']})).operations[0].fields['Custom.Team'], 'default');
});

test('readonly assignment, invalid field values and invalid selection fail before publication', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.Score', 'integer', {allowedValues: [0, 1]});
  for (const fields of [{'System.AreaId': 1}, {'Custom.Score': 'wrong'}, {'Custom.Score': 3}, {'System.AreaPath': 'other\\Catalog'}]) await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01'], fields: fieldChoices('NEW-01', fields)}), /read.only|type|allowed|path|project/i);
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01'], fields: fieldChoices('101', {'Custom.Score': 0})}), /selected|selection/i);
  assert.equal(f.control.writes, 0);
});

test('changed custom schema invalidates pending approval while normalized lost creation reconciles without replay', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.Number', 'integer'); f.control.normalizations['Custom.Number'] = Number;
  extraField(f, 'Custom.When', 'dateTime'); extraField(f, 'Custom.Owner', 'string', {isIdentity: true}); extraField(f, 'Custom.Key', 'guid');
  f.control.normalizations['Custom.When'] = value => new Date(value).toISOString(); f.control.normalizations['Custom.Owner'] = value => ({uniqueName: value, displayName: 'Synthetic owner'}); f.control.normalizations['Custom.Key'] = value => value.toLowerCase();
  const options = {client: f.client, selected: ['NEW-01'], fields: fieldChoices('NEW-01', {'Custom.Number': '2', 'Custom.When': '2026-10-30T10:00:00+02:00', 'Custom.Owner': 'owner@example.test', 'Custom.Key': 'A6D016C4-22AA-4193-8401-43477C226411'})};
  const preview = await previewDesign(f.roots, 'login', options);
  const spec = f.control.fields.find(row => row.referenceName === 'Custom.Number'); spec.allowedValues = [1];
  await assert.rejects(publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint})); assert.equal(f.control.writes, 0);
  delete spec.allowedValues; f.control.loseCreate = true;
  const lost = await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint}); assert.equal(lost.outcomes[0].status, 'uncertain');
  const recovered = await reconcileDesign(f.roots, 'login', {client: f.client}); assert.equal(recovered.mode, 'completed'); assert.equal(f.control.writes, 1);
  assert.equal((await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint})).mode, 'completed'); assert.equal(f.control.writes, 1);
});

test('pre-upgrade preview publishes and reconciles without rewriting its historical binding', async t => {
  const f = await adoDesignFixture(t), preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']});
  const {fingerprint: current, fieldPreview, ...legacy} = structuredClone(preview);
  for (const operation of legacy.operations) delete operation.publicationFields;
  legacy.fingerprint = fingerprint(legacy);
  const path = join(f.roots.projectRoot, '.harness/state/test-case-design/login/previews', `${legacy.fingerprint}.json`), bytes = JSON.stringify(legacy); writeFileSync(path, bytes);
  f.control.loseCreate = true;
  assert.equal((await publishDesign(f.roots, 'login', {client: f.client, approval: legacy.fingerprint})).mode, 'reconciliation-required');
  f.control.denyField = 'System.Description';
  assert.equal((await reconcileDesign(f.roots, 'login', {client: f.client})).mode, 'completed');
  assert.equal(readFileSync(path, 'utf8'), bytes); assert.equal(f.control.writes, 1);
});

test('mandatory choices are bundled across cases and server-only path rejection is identified separately', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.A', 'string', {alwaysRequired: true}); extraField(f, 'Custom.B', 'string', {alwaysRequired: true});
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client}), error => /NEW-01/.test(error.message) && /101/.test(error.message) && /Custom.A/.test(error.message) && /Custom.B/.test(error.message));
  for (const spec of f.control.fields.filter(row => row.referenceName.startsWith('Custom.'))) spec.alwaysRequired = false;
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01'], fields: fieldChoices('NEW-01', {'System.AreaPath': 'demo\\Missing'})}), /ADO server validation rejected.*paths/);
  assert.equal(f.control.writes, 0);
});

test('explicit update field changes are previewed and changed create defaults require renewed approval', async t => {
  const f = await adoDesignFixture(t, {testCases: {fields: {'Custom.Team': 'first'}}}, {existingFields: {'Custom.Team': 'old'}}); extraField(f, 'Custom.Team');
  const update = await previewDesign(f.roots, 'login', {client: f.client, selected: ['101'], fields: fieldChoices('101', {'Custom.Team': 'reviewed'})});
  assert.deepEqual(update.fieldPreview[0].fields, [{referenceName: 'Custom.Team', label: 'Custom.Team', value: 'reviewed', before: 'old'}]);
  await publishDesign(f.roots, 'login', {client: f.client, approval: update.fingerprint}); assert.equal(f.state.items.get(101).fields['Custom.Team'], 'reviewed');
  const create = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']});
  f.client.configuration.testCases.fields['Custom.Team'] = 'second';
  await assert.rejects(publishDesign(f.roots, 'login', {client: f.client, approval: create.fingerprint}), /Native request changed/); assert.equal(f.control.writes, 1);
});

test('CLI preview consumes the consumer fields file and exposes exact field values without writes', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.Team');
  writeFileSync(join(f.roots.projectRoot, '.harness/integrations.json'), JSON.stringify({version: 1, ado: f.config}));
  writeFileSync(join(f.roots.projectRoot, 'case-fields.json'), JSON.stringify(fieldChoices('NEW-01', {'Custom.Team': 'Retail'})));
  const argv = process.argv, originalFetch = globalThis.fetch, originalLog = console.log, originalError = console.error, priorCredential = process.env[f.config.credentialRef], priorCode = process.exitCode, output = [], errors = [];
  try {
    process.argv = [process.execPath, join(f.roots.packageRoot, 'scripts/test-case-design.mjs'), '--project-root', f.roots.projectRoot, 'preview', '--id', 'login', '--selected', 'NEW-01', '--fields', 'case-fields.json'];
    process.env[f.config.credentialRef] = f.credential;
    globalThis.fetch = (url, init) => new URL(url).hostname === 'ado.example.test' ? f.fetchImpl(url, init) : originalFetch(url, init);
    console.log = value => output.push(value); console.error = value => errors.push(value);
    await import(pathToFileURL(join(f.roots.packageRoot, 'scripts/test-case-design.mjs')).href + '?publication-fields-test');
  } finally {
    process.argv = argv; globalThis.fetch = originalFetch; console.log = originalLog; console.error = originalError; process.exitCode = priorCode;
    if (priorCredential === undefined) delete process.env[f.config.credentialRef]; else process.env[f.config.credentialRef] = priorCredential;
  }
  assert.deepEqual(errors, []); const preview = JSON.parse(output[0]);
  assert.equal(preview.fieldPreview[0].fields[0].value, 'Retail'); assert.equal(preview.operations[0].request.body.find(row => row.path === '/fields/Custom.Team').value, 'Retail'); assert.equal(f.control.writes, 0);
});

test('required server-only defaults resolve through validate-only without premature missing-value questions', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.Channel', 'string', {alwaysRequired: true}); f.control.serverDefaults['Custom.Channel'] = 'Web';
  const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']});
  assert(f.control.validations.length > 0); assert.equal(f.control.writes, 0);
  assert.deepEqual(preview.fieldPreview[0].fields.find(field => field.referenceName === 'Custom.Channel'), {referenceName: 'Custom.Channel', label: 'Custom.Channel', value: 'Web', source: 'server-default'});
  assert(!preview.operations[0].request.body.some(row => row.path === '/fields/Custom.Channel'));
  assert.equal((await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint})).mode, 'completed'); assert.equal(f.state.items.get(800).fields['Custom.Channel'], 'Web');
});

test('optional metadata and hidden server defaults are visible and invalidate affected approval when changed', async t => {
  for (const hidden of [false, true]) {
    const f = await adoDesignFixture(t); extraField(f, 'Custom.Channel', 'string', hidden ? {} : {defaultValue: 'Web'});
    if (hidden) f.control.serverDefaults['Custom.Channel'] = 'Web';
    const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']});
    assert.equal(preview.fieldPreview[0].fields.find(field => field.referenceName === 'Custom.Channel').value, 'Web');
    if (hidden) f.control.serverDefaults['Custom.Channel'] = 'Mobile'; else f.control.fields.find(field => field.referenceName === 'Custom.Channel').defaultValue = 'Mobile';
    await assert.rejects(publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint}), /Native request changed/); assert.equal(f.control.writes, 0);
  }
});

test('server defaults reconcile from stored approval and divergent default readback remains uncertain without replay', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.Count', 'integer'); f.control.serverDefaults['Custom.Count'] = '2'; f.control.normalizations['Custom.Count'] = Number;
  const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']});
  assert.equal(preview.fieldPreview[0].fields.find(field => field.referenceName === 'Custom.Count').value, 2);
  f.control.loseCreate = true; assert.equal((await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint})).mode, 'reconciliation-required');
  f.control.serverDefaults['Custom.Count'] = 3; f.control.denyField = 'System.Description';
  assert.equal((await reconcileDesign(f.roots, 'login', {client: f.client})).mode, 'completed'); assert.equal(f.control.writes, 1);
  const changed = await adoDesignFixture(t); extraField(changed, 'Custom.Channel', 'string'); changed.control.serverDefaults['Custom.Channel'] = 'Web';
  const approved = await previewDesign(changed.roots, 'login', {client: changed.client, selected: ['NEW-01']});
  changed.control.beforeWrite = () => {changed.control.serverDefaults['Custom.Channel'] = 'Mobile';};
  assert.equal((await publishDesign(changed.roots, 'login', {client: changed.client, approval: approved.fingerprint})).mode, 'reconciliation-required');
  assert.equal((await reconcileDesign(changed.roots, 'login', {client: changed.client})).mode, 'reconciliation-required');
  assert.equal((await publishDesign(changed.roots, 'login', {client: changed.client, approval: approved.fingerprint})).mode, 'reconciliation-required'); assert.equal(changed.control.writes, 1);
});

test('server rules that materially rewrite a requested field stop the preview before dispatch', async t => {
  const f = await adoDesignFixture(t); extraField(f, 'Custom.Channel'); f.control.normalizations['Custom.Channel'] = () => 'Mobile';
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01'], fields: fieldChoices('NEW-01', {'Custom.Channel': 'Web'})}), /server validation changed requested field Custom.Channel/i);
  assert.equal(f.control.writes, 0);
});

test('unchanged existing large HTML remains preserved without relaxing bounds for new field input', async t => {
  const notes = 'x'.repeat(32769), f = await adoDesignFixture(t, {}, {existingFields: {'Custom.Notes': notes}}); extraField(f, 'Custom.Notes', 'html');
  const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['101']});
  assert.deepEqual(preview.operations[0].publicationFields.preserved, ['Custom.Notes']);
  assert(!preview.operations[0].request.body.some(row => row.path === '/fields/Custom.Notes'));
  assert(!JSON.stringify(preview.operations[0].publicationFields).includes(notes));
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['101'], fields: fieldChoices('101', {'Custom.Notes': notes})}), /bounded scalar/);
  assert.equal((await publishDesign(f.roots, 'login', {client: f.client, approval: preview.fingerprint})).mode, 'completed'); assert.equal(f.state.items.get(101).fields['Custom.Notes'], notes);
});

test('validation cannot silently clear or remove an unrequested existing writable field', async t => {
  for (const value of [null, undefined]) {
    const f = await adoDesignFixture(t, {}, {existingFields: {'Custom.Team': 'existing'}}); extraField(f, 'Custom.Team');
    f.control.normalizations['Custom.Team'] = () => value;
    await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['101']}), /changed preserved field Custom.Team/);
    assert.equal(f.control.writes, 0);
  }
});

test('a dispatch-only rewrite of a preserved field remains uncertain through reconciliation without replay', async t => {
  const f = await adoDesignFixture(t, {}, {existingFields: {'Custom.Team': 'existing'}}); extraField(f, 'Custom.Team');
  const preview = await previewDesign(f.roots, 'login', {client: f.client, selected: ['101']});
  f.control.beforeWrite = () => {f.control.normalizations['Custom.Team'] = () => 'rewritten';};
  const options = {client: f.client, approval: preview.fingerprint};
  assert.equal((await publishDesign(f.roots, 'login', options)).mode, 'reconciliation-required');
  assert.equal((await reconcileDesign(f.roots, 'login', {client: f.client})).mode, 'reconciliation-required');
  assert.equal((await publishDesign(f.roots, 'login', options)).mode, 'reconciliation-required'); assert.equal(f.control.writes, 1);
});

test('mixed native publication preserves unrelated content/tags and prepares once with atomic story link', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client};
  const preview = await previewDesign(f.roots, 'login', options); assert.equal(f.control.writes, 0);
  assert.equal(preview.operations.length, 2);
  await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: 'yes'}), /approval/);
  const result = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(f.control.writes, 2);
  for (const outcome of result.outcomes) {
    assert.equal(outcome.status, 'applied'); const item = f.state.items.get(outcome.adoId), steps = parseStepsXml(item.fields['Microsoft.VSTS.TCM.Steps']);
    assert.equal(steps.length, 2); assert(steps[0].action.includes('Preparation')); assert(steps[0].action.includes('Prerequisites:')); assert(steps[0].action.includes('Test data:'));
    assert.equal(steps[1].expected, f.proposal.cases[0].steps[0].expected);
    assert(item.fields['System.Description'].includes('Story 200')); assert(!item.fields['System.Description'].includes('TEST_PASSWORD'));
    assert(item.fields['System.Tags'].includes('Functional')); assert(item.fields['System.Tags'].includes('Positive'));
  }
  assert(f.state.items.get(101).fields['System.Description'].startsWith('<p>Keep unrelated content.</p>')); assert(f.state.items.get(101).fields['System.Tags'].includes('team-owned'));
  const created = f.state.items.get(result.outcomes[0].adoId); assert.equal(created.relations[0].rel, 'Microsoft.VSTS.Common.TestedBy-Reverse');
  assert.equal((await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint})).mode, 'completed'); assert.equal(f.control.writes, 2);
});

test('lost creation acknowledgement reconciles operation history and never duplicates creation', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client, selected: ['NEW-01']}, preview = await previewDesign(f.roots, 'login', options); f.control.loseCreate = true;
  const uncertain = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}); assert.equal(uncertain.outcomes[0].status, 'uncertain'); assert.equal(f.control.writes, 1);
  assert.equal((await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint})).mode, 'reconciliation-required'); assert.equal(f.control.writes, 1);
  const recovered = await reconcileDesign(f.roots, 'login', {client: f.client}); assert.equal(recovered.outcomes[0].status, 'applied'); assert.equal(recovered.outcomes[0].adoId, 800); assert.equal(f.control.writes, 1);
  assert.equal(readDesign(f.roots, 'login').delivery.outcomes[0].adoId, 800);
});

test('changed sources, cases, fields and tag capability block affected publication before writes', async t => {
  for (const kind of ['story', 'case', 'field', 'tags', 'discussion']) {
    const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
    if (kind === 'story') f.state.items.get(200).rev++;
    if (kind === 'case') f.state.items.get(101).rev++;
    if (kind === 'field') f.control.denyField = 'System.Description';
    if (kind === 'tags') f.control.denyTags = true;
    if (kind === 'discussion') f.control.discussion.push({id: 1, version: 1, text: 'Changed expectation.'});
    await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint})); assert.equal(f.control.writes, 0, kind);
  }
});

test('partial acknowledgement keeps completed operation and resumes only remaining authorized work', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  f.control.loseUpdate = true;
  const result = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}); assert.deepEqual(result.outcomes.map(row => row.status), ['applied', 'uncertain']);
  const recovered = await reconcileDesign(f.roots, 'login', options); assert.deepEqual(recovered.outcomes.map(row => row.status), ['applied', 'applied']); assert.equal(f.control.writes, 2);
});

test('reuse verifies native content and repeated update reconciles existing preparation without loss', async t => {
  const f = await adoDesignFixture(t, {}, {existingFields: {'Custom.Team': 'existing'}}); extraField(f, 'Custom.Team');
  const options = {client: f.client, selected: ['101']}, preview = await previewDesign(f.roots, 'login', options);
  await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  let state = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  const row = structuredClone(f.proposal.cases[1]); row.proposedAction = 'Reuse unchanged';
  const proposal = {...f.proposal, source: state.source, cases: [row], mappings: f.proposal.mappings.filter(row => row.caseId === '101'), preparations: f.proposal.preparations.filter(row => row.caseId === '101')};
  state = saveDesign(f.roots, 'login', proposal);
  const assessment = {version: 1, proposal: state.proposal, reviewer: 'fresh-reviewer', cases: [{id: '101', verdict: 'pass', reason: 'Actual native content matches the accepted story.'}], requirements: [{id: row.coverageReferences[0].requirementId, verdict: 'covered', reason: 'Exact observable outcome verifies the accepted rule.', caseIds: ['101']}]};
  assessDesign(f.roots, 'login', retainAssessment(f.roots, state, assessment));
  await assert.rejects(previewDesign(f.roots, 'login', {...options, fields: fieldChoices('101', {'Custom.Team': 'different'})}), /reviewed Update/);
  await assert.rejects(previewDesign(f.roots, 'login', {...options, fields: fieldChoices('101', {'System.AreaId': 1})}), /read.only/);
  const unchanged = await previewDesign(f.roots, 'login', options); assert.equal(unchanged.operations[0].request, null);
  const reused = await publishDesign(f.roots, 'login', {...options, approval: unchanged.fingerprint}); assert.equal(reused.outcomes[0].status, 'unchanged'); assert.equal(f.control.writes, 1);
  state = await prepareDesign(f.roots, 'second-edit', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  row.proposedAction = 'Update'; row.title = 'Sign in with the correct identity';
  state = saveDesign(f.roots, 'second-edit', {...proposal, source: state.source, cases: [row]}); assessDesign(f.roots, 'second-edit', retainAssessment(f.roots, state, {...assessment, proposal: state.proposal}));
  const changed = await previewDesign(f.roots, 'second-edit', options); await publishDesign(f.roots, 'second-edit', {...options, approval: changed.fingerprint});
  assert.equal(parseStepsXml(f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps']).filter(step => step.action.startsWith('Preparation')).length, 1); assert.equal(f.control.writes, 2);
});

test('concurrent requirement change after a creation blocks remaining updates despite the owned story link', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  f.control.afterWrite = item => {if (item.id === 800) f.state.items.get(200).fields['Microsoft.VSTS.Common.AcceptanceCriteria'] = 'A different accepted rule.';};
  const result = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  assert.deepEqual(result.outcomes.map(row => row.status), ['applied', 'failed']); assert.equal(f.control.writes, 1);
});

test('rewriting a saved preview with a self-consistent new hash cannot reuse the old approval', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  const path = join(f.roots.projectRoot, '.harness/state/test-case-design/login/previews', `${preview.fingerprint}.json`), saved = JSON.parse(readFileSync(path));
  delete saved.fingerprint; saved.selected = ['NEW-01']; saved.operations = saved.operations.slice(0, 1); saved.fingerprint = fingerprint(saved); writeFileSync(path, JSON.stringify(saved));
  await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}), /approved identity/); assert.equal(f.control.writes, 0);
});
