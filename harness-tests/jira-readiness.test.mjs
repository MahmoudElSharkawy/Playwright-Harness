import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {runCheck, OPTIONAL, WAITING} from '../scripts/lib/check.mjs';
test('Jira-only readiness checks selected credential references without requiring Azure or plugin secrets for none', t => {
  const {roots} = fixture(t); mkdirSync(join(roots.projectRoot, '.harness'), {recursive: true});
  writeFileSync(join(roots.projectRoot, '.harness/integrations.json'), JSON.stringify({version: 1, defaultProvider: 'jira', jira: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'FIXTURE_JIRA_EMAIL', credentialRef: 'FIXTURE_JIRA_TOKEN', testManagement: {provider: 'none'}}}));
  const result = runCheck(roots), feature = name => result.features.find(item => item.name === name);
  assert.deepEqual(result.errors, []); assert.equal(feature('Azure DevOps').status, OPTIONAL);
  assert.equal(feature('Jira').status, WAITING); assert.match(feature('Jira').detail, /FIXTURE_JIRA_EMAIL/); assert.match(feature('Jira').detail, /FIXTURE_JIRA_TOKEN/);
  assert.match(feature('Work-item links').detail, /example.atlassian.net\/browse\/%s/); assert.equal(feature('Jira test management').status, OPTIONAL);
});

test('Zephyr readiness preserves native case links separately from Jira issue links', t => {
  const {roots} = fixture(t); mkdirSync(join(roots.projectRoot, '.harness'), {recursive: true});
  writeFileSync(join(roots.projectRoot, '.harness/integrations.json'), JSON.stringify({version: 1, defaultProvider: 'jira', jira: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'FIXTURE_JIRA_EMAIL', credentialRef: 'FIXTURE_JIRA_TOKEN', testManagement: {provider: 'zephyr-scale', region: 'eu', credentialRef: 'FIXTURE_ZEPHYR_TOKEN'}}}));
  const result = runCheck(roots); assert.deepEqual(result.errors, []);
  assert.match(result.features.find(item => item.name === 'Work-item links').detail, /native Zephyr case URL using allure.link/);
});
