#!/usr/bin/env node
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {command, npmPath} from './process.mjs';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {testCounts, completeTests, completeChecks} from './results.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';

/** One fixed package check list. Missing, failed, skipped and empty tests do not pass. */
export function runChecks(root, audit) {
  assert(!within(realFuture(root), realFuture(audit)), 'Use an external audit directory, outside the package.');
  mkdirSync(audit, {recursive: true, mode: 0o700});
  const tests = readdirSync(join(root, 'harness-tests')).filter(file => file.endsWith('.test.mjs')).sort();
  if (!tests.length) throw new Error('No tests discovered.');
  const definitions = [
    ...['syntax', 'json', 'links', 'privacy', 'secrets', 'provenance', 'publication'].map(name => [name, ['scripts/validate-package.mjs', name]]),
    ['contracts', ['scripts/ci/contracts.mjs']],
    ['conventions', ['scripts/check-conventions.mjs', '--root', 'examples', '--fail-on-warn']],
    ['generation-conventions', ['scripts/check-conventions.mjs', '--root', 'harness-tests/fixtures/generation-consumer', '--fail-on-warn']],
    ['workflow-conventions', ['scripts/check-conventions.mjs', '--root', 'harness-tests/fixtures/workflow-consumer', '--fail-on-warn']],
    ['types', ['scripts/ci/types.mjs', join(audit, 'type-consumer')]],
    ['fetch', ['scripts/fetch-ado-suite.mjs', '--self-test']],
    ['tests', ['--test', '--test-reporter=tap', ...tests.map(file => `harness-tests/${file}`)]]
  ];
  const env = {npm_execpath: npmPath(), npm_config_cache: join(audit, 'npm-cache')};
  const checks = definitions.map(([id, args]) => {
    const result = command(args, {cwd: root, env, log: join(audit, `${id}.log`)});
    const counts = id === 'tests' ? testCounts(result.output) : undefined;
    const check = {id, status: result.status === 'PASS' && (!counts || completeTests(counts)) ? 'PASS' : 'FAIL', exitCode: result.exitCode, diagnostic: result.diagnostic, log: `${id}.log`, sha256: result.sha256,
      ...(counts ? {counts} : {})}; console.log(JSON.stringify(check)); return check;
  });
  const summary = {version: 1, status: completeChecks(checks) ? 'PASS' : 'FAIL', platform: process.platform, node: process.version, testFiles: tests.length, checks};
  writeFileSync(join(audit, 'checks.json'), JSON.stringify(summary, null, 2), {flag: 'wx', mode: 0o600}); return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const audit = process.argv[2] ? resolve(process.argv[2]) : join(tmpdir(), `harness-ci-${randomUUID()}`);
  if (process.argv.length > 3) throw new Error('Supply one new audit directory.');
  console.log(JSON.stringify({privateAudit: audit}));
  const summary = runChecks(packageRoot, audit); if (summary.status !== 'PASS') process.exitCode = 1;
}
