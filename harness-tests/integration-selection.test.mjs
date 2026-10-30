import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {selectTracker, createTrackerClient, trackerProvider} from '../scripts/lib/integrations/selection.mjs';

const ado = {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_TOKEN'};
const jira = {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'};
function configure(roots, configuration) {mkdirSync(join(roots.projectRoot, '.harness'), {recursive: true}); writeFileSync(join(roots.projectRoot, '.harness/integrations.json'), JSON.stringify(configuration));}

test('explicit source selection overrides the default without changing configured destinations', t => {
  const {roots} = fixture(t); configure(roots, {version: 1, defaultProvider: 'jira', ado, jira});
  assert.equal(selectTracker(roots), 'jira'); assert.equal(selectTracker(roots, 'ado'), 'ado');
  assert.equal(trackerProvider(createTrackerClient(roots)), 'jira');
  assert.equal(trackerProvider(createTrackerClient(roots, {provider: 'ado'})), 'ado');
});

test('ADO remains the compatible default and injected clients need no consumer configuration', t => {
  const {roots} = fixture(t); configure(roots, {version: 1, ado, jira});
  assert.equal(selectTracker(roots), 'ado');
  const injected = {configuration: {organizationUrl: ado.organizationUrl}};
  assert.equal(createTrackerClient(roots, {client: injected}), injected);
  assert.equal(trackerProvider(injected), 'ado');
});

test('Jira-only selection is lazy and unused malformed ADO configuration is ignored', t => {
  const {roots} = fixture(t); configure(roots, {version: 1, defaultProvider: 'jira', ado: {}, jira});
  assert.equal(createTrackerClient(roots, {environment: {}}).configuration.siteUrl, jira.siteUrl);
  configure(roots, {version: 1, jira}); assert.equal(selectTracker(roots), 'jira');
});

test('invalid or missing selected providers fail before any transport call', t => {
  const {roots} = fixture(t); configure(roots, {version: 1, defaultProvider: 'jira', ado});
  assert.throws(() => selectTracker(roots), /configured/);
  assert.throws(() => selectTracker(roots, 'github'), /provider/);
  configure(roots, {version: 1, ado, defaultProvider: 'other'}); assert.throws(() => selectTracker(roots), /provider/);
});
