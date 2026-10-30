import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {loadAdoConfiguration} from '../scripts/lib/integrations/config.mjs';
import {loadJiraConfiguration, validateJiraConfiguration} from '../scripts/lib/integrations/jira-config.mjs';

const configuration = () => ({siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'});
const put = (roots, path, value) => {const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));};

test('Jira configuration defaults to classic authentication and no test-management plugin', () => {
  const config = validateJiraConfiguration(configuration());
  assert.equal(config.authType, 'classic'); assert.deepEqual(config.testManagement, {provider: 'none'});
  assert.equal(config.timeoutMs, 30000); assert.equal(config.maxResponseBytes, 2 * 1024 * 1024); assert(Object.isFrozen(config));
});

test('Jira credentials are resolved lazily and plugin credentials stay separate', t => {
  const {roots} = fixture(t), config = configuration();
  put(roots, '.harness/integrations.json', {version: 1, defaultProvider: 'jira', jira: config});
  const loaded = loadJiraConfiguration(roots, {});
  const token = crypto.randomUUID(); put(roots, '.env', `JIRA_EMAIL=qa@example.test\nJIRA_TOKEN=${token}\nXRAY_SECRET=unused\n`);
  assert.equal(loaded.resolveEmail(), 'qa@example.test'); assert.equal(loaded.resolveCredential(), token);
  assert.deepEqual(loaded.resolveTestManagementCredentials(), {});
});

test('mixed configuration preserves explicit ADO loading and does not validate or resolve unused Jira secrets', t => {
  const {roots} = fixture(t), ado = {organizationUrl: 'https://ado.example.test/collection', project: 'demo', credentialRef: 'ADO_TOKEN'};
  put(roots, '.harness/integrations.json', {version: 1, defaultProvider: 'jira', ado, jira: {credentialRef: 'NOT_CONFIGURED'}});
  const loaded = loadAdoConfiguration(roots, {}, {ADO_TOKEN: '<synthetic>'});
  assert.equal(loaded.configuration.project, 'demo'); assert.equal(loaded.resolveCredential(), '<synthetic>');
});

test('selected plugin receives only its own credential references', t => {
  const {roots} = fixture(t), config = configuration();
  config.testManagement = {provider: 'xray', clientIdRef: 'XRAY_ID', clientSecretRef: 'XRAY_SECRET'};
  put(roots, '.harness/integrations.json', {version: 1, jira: config});
  assert.deepEqual(loadJiraConfiguration(roots, {XRAY_ID: 'id', XRAY_SECRET: '<secret>', ZEPHYR_TOKEN: '<unused>'}).resolveTestManagementCredentials(), {clientId: 'id', clientSecret: '<secret>'});
  config.testManagement = {provider: 'zephyr-scale', credentialRef: 'ZEPHYR_TOKEN', region: 'eu'};
  put(roots, '.harness/integrations.json', {version: 1, jira: config});
  assert.deepEqual(loadJiraConfiguration(roots, {ZEPHYR_TOKEN: '<selected>'}).resolveTestManagementCredentials(), {token: '<selected>'});
});

test('selected native plugin accepts bounded case defaults and explicit field metadata selection', () => {
  const config = configuration();
  config.testManagement = {provider: 'xray', clientIdRef: 'XRAY_ID', clientSecretRef: 'XRAY_SECRET', testIssueTypeId: '10004', caseFields: {customfield_12345: {id: '7'}}};
  assert.deepEqual(validateJiraConfiguration(config).testManagement.caseFields, config.testManagement.caseFields);
  config.testManagement = {provider: 'zephyr-scale', credentialRef: 'ZEPHYR_TOKEN', region: 'eu', caseFields: {Risk: 'High'},
    caseFieldSchema: {siteUrl: config.siteUrl, project: config.project, reviewedAt: '2026-10-30T00:00:00Z', fields: [{name: 'Risk', type: 'Select List (Single Choice)', required: true, allowedValues: ['High', 'Low']}], requiredStepFields: []}};
  assert.deepEqual(validateJiraConfiguration(config).testManagement.caseFields, {Risk: 'High'});
  config.testManagement.caseFieldSchema.siteUrl = 'https://example-other.atlassian.net';
  assert.throws(() => validateJiraConfiguration(config), /site|project|binding/i);
});

test('native field configuration rejects unsupported or unsafe inputs and does not require schema for read-only setup', () => {
  const config = configuration();
  config.testManagement = {provider: 'zephyr-scale', credentialRef: 'ZEPHYR_TOKEN', region: 'eu'};
  assert.equal(validateJiraConfiguration(config).testManagement.caseFieldSchema, undefined);
  config.testManagement.caseFields = [];
  assert.throws(() => validateJiraConfiguration(config), /fields/i);
  config.testManagement = {provider: 'none', caseFields: {Risk: 'High'}};
  assert.throws(() => validateJiraConfiguration(config));
  config.testManagement = {provider: 'xray', clientIdRef: 'XRAY_ID', clientSecretRef: 'XRAY_SECRET', testIssueTypeId: '../1'};
  assert.throws(() => validateJiraConfiguration(config), /issue.type/i);
});

test('configured Jira context retains fixed IDs or saved criteria without mixing them', () => {
  const config = configuration(); config.context = {sources: {release: {scope: {issueKeys: ['DEMO-1']}}}};
  assert.deepEqual(validateJiraConfiguration(config).context.sources.release.scope.issueKeys, ['DEMO-1']);
  config.context.sources.release.scope = {jql: 'status = "Open"'}; assert.equal(validateJiraConfiguration(config).context.sources.release.scope.jql, 'status = "Open"');
  config.context.sources.release.scope.issueKeys = ['DEMO-1']; assert.throws(() => validateJiraConfiguration(config), /selection/);
});

for (const [name, change] of [
  ['untrusted host', c => c.siteUrl = 'https://jira.example.test'], ['embedded credentials', c => {const url = new URL(c.siteUrl); url.username = 'user'; c.siteUrl = url.href;}],
  ['path', c => c.siteUrl += '/other'], ['port', c => c.siteUrl += ':444'], ['escaped route', c => c.project = '../DEMO'],
  ['inline token', c => c.credentialRef = 'env:secret'], ['unknown field', c => c.extra = true], ['timeout', c => c.timeoutMs = 0],
  ['scoped without cloud', c => c.authType = 'scoped'], ['classic with cloud', c => c.cloudId = '11111111-1111-4111-8111-111111111111'],
  ['unknown plugin', c => c.testManagement = {provider: 'zephyr'}], ['plugin without credentials', c => c.testManagement = {provider: 'xray'}],
  ['unsupported story type override', c => c.issueTypes = {story: 'Story'}], ['unsupported test type override', c => c.issueTypes = {test: 'Test'}],
  ['unsupported generic issue steps', c => c.fields = {steps: 'customfield_10001'}],
  ['Zephyr without region', c => c.testManagement = {provider: 'zephyr-scale', credentialRef: 'TOKEN'}],
  ['none with credentials', c => c.testManagement = {provider: 'none', credentialRef: 'TOKEN'}]
]) test(`Jira configuration rejects ${name}`, () => {const config = configuration(); change(config); assert.throws(() => validateJiraConfiguration(config));});
