import test from 'node:test';
import assert from 'node:assert/strict';
import {allureLinkTemplates, validateAllureLinks, allureLinkUsage, consumerConventionFindings} from '../scripts/lib/convention-source.mjs';
import {workItemUrlTemplate} from '../scripts/lib/integrations/config.mjs';

const links = {
  tms: {urlTemplate: 'https://dev.azure.com/example-org/Example%20Project/_workitems/edit/%s', nameTemplate: 'Test: #%s'},
  issue: {urlTemplate: 'https://bugs.example.com/items/%s', nameTemplate: 'Defect %s'},
};
const config = options => `export default defineConfig({ reporter: [['list'], ['allure-playwright', {environmentInfo: environment, resultsDir: results, ${options}}]] });`;
// Construct intentionally invalid synthetic userinfo without publishing a credential-shaped URL.
const userinfo = new URL('https://example.com/%s'); userinfo.username = 'synthetic'; userinfo.password = '<invalid>';

test('literal link reader preserves separate destinations and custom names without evaluating config', () => {
  const source = config(`links: ${JSON.stringify(links)}`);
  assert.deepEqual(allureLinkTemplates(source), {state: 'CONFIGURED', links});
  assert.deepEqual(allureLinkTemplates(config(`links: {tms: ${JSON.stringify(links.tms)}}`)), {state: 'CONFIGURED', links: {tms: links.tms}});
  assert.deepEqual(validateAllureLinks(links), links);
});

test('missing and placeholder links are distinguished from unsupported dynamic configuration', () => {
  for (const source of ['', 'export default {};', config(''), config('links: {}'), `// ${config(`links: ${JSON.stringify(links)}`)}`]) assert.equal(allureLinkTemplates(source).state, 'NONE');
  assert.equal(allureLinkTemplates(config(`links: {tms: {urlTemplate: 'https://dev.azure.com/your-org/your-project/_workitems/edit/%s'}}`)).state, 'PLACEHOLDER');
  for (const source of [
    'export default {reporter: reporters};', config('...reporting'), config('links'), config('links: configuredLinks'),
    config('links: {...configuredLinks}'), config('links: {tms: template}'),
    config('links: {tms: {urlTemplate: id => buildUrl(id)}}'),
    config('links: {tms: {urlTemplate: `https://${host}/items/%s`}}'),
    config('links: {tms: {urlTemplate: process.env.WORK_ITEM_TEMPLATE}}'),
    config(`links: ${JSON.stringify(links)}, ...otherOptions`),
    `export default {reporter:[['allure-playwright',{links:${JSON.stringify(links)}}]], ...otherConfig};`,
    `export default defineConfig({reporter:[['allure-playwright',{links:${JSON.stringify(links)}}]]}, current);`,
    `const unused = {reporter:[['allure-playwright',{links:${JSON.stringify(links)}}]]}; export default current;`,
    `module.exports = {reporter:[['allure-playwright',{links:${JSON.stringify(links)}}]]}; module.exports.reporter = current;`,
  ]) assert.equal(allureLinkTemplates(source).state, 'UNRESOLVED', source);
});

test('invalid literal link options cannot enter the reporter adapter', () => {
  for (const value of [null, [], {custom: links.tms}, {tms: {}}, {tms: {urlTemplate: 'not a URL %s'}},
    {tms: {urlTemplate: 'https://example.com/no-placeholder'}}, {tms: {urlTemplate: 'https://example.com/%s/%s'}},
    {tms: {urlTemplate: userinfo.href}}, {tms: {urlTemplate: 'file:///items/%s'}},
    {tms: {...links.tms, nameTemplate: () => 'dynamic'}}, {tms: {...links.tms, extra: true}},
  ]) assert.throws(() => validateAllureLinks(value));
});

test('work-item URL formatting handles configured collection forms and escaped project names without credentials', () => {
  const organizations = ['https://dev.azure.com/example-org/', `https://example-org.${'visualstudio.com'}`, 'https://ado.example.com/tfs/DefaultCollection'];
  for (const organization of organizations) for (const project of ['Example Project', 'مشروع', 'abec6588-9a19-4acd-a7c4-7287fe0ca502']) {
    const template = workItemUrlTemplate(organization, project);
    assert.equal(template, `${organization.replace(/\/$/, '')}/${encodeURIComponent(project)}/_workitems/edit/%s`);
    assert.equal(new URL(template.replace('%s', '123')).protocol, 'https:');
  }
  for (const [organization, project] of [['http://ado.example.com', 'Project'], [userinfo.href, 'Project'], ['https://ado.example.com?q=1', 'Project'], ['https://ado.example.com', '../Project']]) assert.throws(() => workItemUrlTemplate(organization, project));
});

test('metadata aliases and the public synchronous API are recognized by focused checks', () => {
  const source = `import {tms as caseLink} from 'allure-js-commons';\nimport * as synchronous from 'allure-js-commons/sync';\nawait caseLink('101');\nsynchronous.issue('202');`;
  assert.deepEqual(allureLinkUsage(source).map(item => item.kind), ['tms', 'issue']);
  assert.deepEqual(consumerConventionFindings(source), []);
  assert.equal(consumerConventionFindings(`import * as allure from 'allure-js-commons/sync';\nallure.tms('101');`).length, 0);
});
