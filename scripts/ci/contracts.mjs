#!/usr/bin/env node
// Validate supported data contracts with their real validators; parsing alone is not a gate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {validateConfiguration} from '../lib/project-config.mjs';
import {validateLocalSource} from '../lib/local-source.mjs';
import {workflowCases} from '../../harness-tests/fixtures/workflow.mjs';
import {generationCases} from '../../harness-tests/fixtures/generation.mjs';

export function checkContracts(root = resolve(import.meta.dirname, '../..')) {
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const pkg = json('package.json'), lock = json('npm-shrinkwrap.json'), plugin = json('.claude-plugin/plugin.json');
  assert.equal(pkg.version, readFileSync(join(root, 'VERSION'), 'utf8').trim()); assert.equal(plugin.version, pkg.version);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version); assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.equal(pkg.private, true, 'Release requires a separate explicit decision.'); assert.deepEqual(plugin.skills, ['./.agents/skills/']);
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
