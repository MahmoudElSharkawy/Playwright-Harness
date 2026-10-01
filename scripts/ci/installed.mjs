#!/usr/bin/env node
// Install an actual npm archive into a fresh owned directory; never copy source/node_modules.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {join, resolve, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {command, npmPath, hash} from './process.mjs';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {within, realFuture} from '../lib/skill-roots.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';
import {validateInstalledGraph} from './distribution.mjs';

if (process.argv.length !== 3) throw new Error('Supply a new directory outside the source package for installed validation.');
const workspace = join(realpathSync.native(dirname(resolve(process.argv[2]))), basename(process.argv[2])); assert(!within(realpathSync.native(packageRoot), realFuture(workspace)), 'Keep installed validation outside the source package.');
mkdirSync(workspace, {mode: 0o700});
const env = {npm_config_cache: join(workspace, 'cache')}, npm = npmPath(); let sequence = 0;
function run(args, cwd) {
  const result = command(args, {cwd, env, log: join(workspace, `install-${++sequence}.log`), timeout: 600000});
  assert.equal(result.status, 'PASS', `Installation step ${sequence} failed; inspect its private log.`); return result.output;
}
const packed = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', workspace], packageRoot));
assert.equal(packed.length, 1); assert(packed[0].files.some(file => file.path === 'npm-shrinkwrap.json'), 'The distributed dependency lock is required.');
const archive = join(workspace, packed[0].filename), install = join(workspace, 'installation'); mkdirSync(install);
writeFileSync(join(install, 'package.json'), JSON.stringify({name: 'harness-installed-validation', version: '1.0.0', private: true}), {flag: 'wx'});
run([npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--install-strategy=nested', archive], install);
const installedRoot = realpathSync.native(join(install, 'node_modules/playwright-pom-harness'));
for (const prefix of ['examples', 'scripts/spikes/playwright-cli']) run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', join(installedRoot, prefix)], install);
const lock = JSON.parse(readFileSync(join(installedRoot, 'npm-shrinkwrap.json'), 'utf8')), dependencies = validateInstalledGraph(install, lock);
const before = snapshotInstalledPackage(install);
const {runChecks} = await import(pathToFileURL(join(installedRoot, 'scripts/ci/checks.mjs')).href);
const checks = runChecks(installedRoot, join(workspace, 'checks'));
const packageUnchanged = JSON.stringify(snapshotInstalledPackage(install)) === JSON.stringify(before);
const result = {version: 1, status: checks.status === 'PASS' && packageUnchanged ? 'PASS' : 'FAIL', platform: process.platform, node: process.version,
  archive: {name: packed[0].filename, sha256: hash(readFileSync(archive)), integrity: packed[0].integrity, files: packed[0].files.length}, dependencies,
  installedEntries: before.length, packageUnchanged, checks};
writeFileSync(join(workspace, 'installed.json'), JSON.stringify(result, null, 2), {flag: 'wx', mode: 0o600});
writeFileSync(join(workspace, 'paths.json'), JSON.stringify({workspace, installedRoot, archive}, null, 2), {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({status: result.status, platform: process.platform, dependencies, packageUnchanged})); if (result.status !== 'PASS') process.exitCode = 1;
