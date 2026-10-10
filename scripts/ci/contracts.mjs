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
import {checkVersionContracts} from './version.mjs';

export function checkContracts(root = resolve(import.meta.dirname, '../..')) {
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const {pkg, lock} = checkVersionContracts(root);
  // One pinned native CLI graph: the runtime check, the package dependency, the example framework and the development spike.
  const examples = json('examples/package.json'), spike = json('scripts/spikes/playwright-cli/package.json');
  for (const pinned of [pkg.dependencies['@playwright/cli'], examples.devDependencies['@playwright/cli'], spike.dependencies['@playwright/cli']]) assert.equal(pinned, NATIVE_CLI_PIN.cli, 'The native CLI pin differs between package manifests.');
  for (const name of ['playwright', 'playwright-core']) assert.equal(lock.packages[`node_modules/${name}`]?.version, NATIVE_CLI_PIN.playwright, 'The locked native Playwright graph differs from the runtime pin.');
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
