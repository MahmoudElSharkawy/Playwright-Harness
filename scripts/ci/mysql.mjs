#!/usr/bin/env node
// Fixed MySQL native proof against the clean installed archive; publish only sanitized evidence.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {command} from './process.mjs';
import {completeChecks, testCounts, completeTests, testFailureDiagnostics} from './results.mjs';
import {within} from '../lib/skill-roots.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';

assert(process.argv.length === 3, 'Use <installed-workspace>.');
const workspace = realpathSync(resolve(process.argv[2])), paths = JSON.parse(readFileSync(join(workspace, 'paths.json'), 'utf8'));
const root = realpathSync(paths.installedRoot), installation = realpathSync(join(workspace, 'installation'));
assert(within(installation, root) && within(workspace, installation));
const installed = JSON.parse(readFileSync(join(workspace, 'installed.json'), 'utf8'));
assert(installed.status === 'PASS' && installed.packageUnchanged && completeChecks(installed.checks.checks), 'Installed checks must pass first.');
const before = snapshotInstalledPackage(installation);
const result = command([join(root, 'scripts/probes/mysql.mjs')], {cwd: root, log: join(workspace, 'mysql-native.log'), timeout: 720000});
const counts = testCounts(result.output), records = result.output.split(/\r?\n/).flatMap(line => {try {return [JSON.parse(line)];} catch {return [];}});
const proof = records.find(record => record.probe === 'mysql'), cleanup = records.find(record => record.probe === 'mysql-cleanup');
const packageUnchanged = JSON.stringify(snapshotInstalledPackage(installation)) === JSON.stringify(before);
const complete = result.status === 'PASS' && completeTests(counts) && proof?.status === 'PASS' && proof.liveDatabase === true && proof.nativeBrowserRequired === true
  && cleanup?.status === 'PASS' && cleanup.ownedContainerRemoved === true && cleanup.ownedCertificateRemoved === true && packageUnchanged;
const summary = {version: 1, kind: 'mysql', status: complete ? 'PASS' : 'INCOMPLETE', platform: process.platform, node: process.version,
  archive: installed.archive, packageUnchanged, counts, ownedContainerRemoved: cleanup?.ownedContainerRemoved === true, ownedCertificateRemoved: cleanup?.ownedCertificateRemoved === true,
  process: {status: result.status, exitCode: result.exitCode, diagnostic: result.diagnostic, log: 'mysql-native.log', sha256: result.sha256},
  ...(!complete ? {failures: testFailureDiagnostics(result.output, ['mysql.integration.mjs', 'mysql-runtime.test.mjs', 'mysql-driver.test.mjs', 'mysql-syntax.test.mjs'])} : {})};
writeFileSync(join(workspace, 'native-mysql.json'), JSON.stringify(summary, null, 2), {flag: 'wx', mode: 0o600});
console.log(JSON.stringify(summary)); if (!complete) process.exitCode = 1;
