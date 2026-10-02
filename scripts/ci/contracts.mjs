#!/usr/bin/env node
// Validate supported data contracts with their real validators; parsing alone is not a gate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {validateConfiguration} from '../lib/project-config.mjs';
import {validateLocalSource} from '../lib/local-source.mjs';
import {NATIVE_CLI_PIN} from '../lib/browser/native-cli.mjs';
import {INSTRUCTION_BLOCK} from '../lib/adoption.mjs';
import {workflowCases} from '../../harness-tests/fixtures/workflow.mjs';
import {generationCases} from '../../harness-tests/fixtures/generation.mjs';

export function checkContracts(root = resolve(import.meta.dirname, '../..')) {
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const pkg = json('package.json'), lock = json('npm-shrinkwrap.json'), plugin = json('.claude-plugin/plugin.json');
  assert.equal(pkg.version, readFileSync(join(root, 'VERSION'), 'utf8').trim()); assert.equal(plugin.version, pkg.version);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version); assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.equal(pkg.private, true, 'Release requires a separate explicit decision.'); assert.deepEqual(plugin.skills, ['./.agents/skills/']);
  // One pinned native CLI graph: the runtime check, the package dependency, the example framework and the development spike.
  const examples = json('examples/package.json'), spike = json('scripts/spikes/playwright-cli/package.json');
  for (const pinned of [pkg.dependencies['@playwright/cli'], examples.devDependencies['@playwright/cli'], spike.dependencies['@playwright/cli']]) assert.equal(pinned, NATIVE_CLI_PIN.cli, 'The native CLI pin differs between package manifests.');
  for (const name of ['playwright', 'playwright-core']) assert.equal(lock.packages[`node_modules/${name}`]?.version, NATIVE_CLI_PIN.playwright, 'The locked native Playwright graph differs from the runtime pin.');
  // The newest released version tells upgraders what to do; setup shows that list.
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replaceAll('\r\n', '\n');
  const newest = changelog.match(/^## (\d+\.\d+\.\d+)\b.*\n([\s\S]*?)(?=^## \d+\.\d+\.\d+\b|(?![\s\S]))/m);
  assert.equal(newest?.[1], pkg.version, 'The newest CHANGELOG version heading must be the package version.');
  assert.match(newest[2], /^### Upgrade actions\n+- \S/m, 'The newest CHANGELOG version needs an "### Upgrade actions" list.');
  // A later version can replace this block only if its digest is recorded as released.
  assert(json('scripts/managed-digests.json').instructionBlocks.includes(createHash('sha256').update(INSTRUCTION_BLOCK).digest('hex')),
    'Record the current managed instruction block in scripts/managed-digests.json.');
  let profiles = 0;
  for (const environmentMode of ['test', 'protected', 'custom']) {
    const project = {version: 1, defaultEnvironment: 'sample', environments: {sample: {environmentMode, apiTargets: ['api'], databaseTargets: ['db'], browserTargets: ['ui']}}};
    const targets = {api: {api: {baseUrl: 'https://api.example.test', credentialRef: 'env:API_ACCESS'}}, databases: {db: {engine: 'sqlserver', database: 'Synthetic', schema: 'sample', server: 'localhost', connectionRef: 'env:DB_ACCESS'}}, browser: {ui: {origins: ['https://ui.example.test']}}};
    validateConfiguration(project, targets); profiles++;
  }
  const sources = [generationCases().source, workflowCases().source].map(validateLocalSource);
  assert(sources.every(source => source.scenarios.length > 0));
  return {status: 'PASS', packageContracts: 3, profiles, sources: sources.length, scenarios: sources.reduce((sum, source) => sum + source.scenarios.length, 0),
    expectations: sources.reduce((sum, source) => sum + source.scenarios.reduce((n, scenario) => n + scenario.steps.reduce((m, step) => m + step.expected.length, 0), 0), 0)};
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) console.log(JSON.stringify(checkContracts()));
