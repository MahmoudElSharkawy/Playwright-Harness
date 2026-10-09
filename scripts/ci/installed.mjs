#!/usr/bin/env node
// Install an actual npm archive into a fresh owned directory; never copy source/node_modules.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, realpathSync, copyFileSync, constants} from 'node:fs';
import {join, resolve, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {command, npmPath} from './process.mjs';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {within, realFuture} from '../lib/skill-roots.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';
import {validateInstalledGraph, clearedOverrides} from './distribution.mjs';
import {inspectArchive} from './archive.mjs';

const {positionals, values} = parseArgs({allowPositionals: true, options: {archive: {type: 'string'}, sha256: {type: 'string'}}});
assert(positionals.length === 1 && Boolean(values.archive) === Boolean(values.sha256), 'Use <new external workspace> [--archive <file> --sha256 <digest>].');
const workspace = join(realpathSync.native(dirname(resolve(positionals[0]))), basename(positionals[0])); assert(!within(realpathSync.native(packageRoot), realFuture(workspace)), 'Keep installed validation outside the source package.');
const supplied = values.archive ? inspectArchive(resolve(values.archive), packageRoot, values.sha256) : undefined;
const expectedLock = JSON.parse(readFileSync(join(packageRoot, 'npm-shrinkwrap.json'), 'utf8')), overrides = clearedOverrides(expectedLock);
mkdirSync(workspace, {mode: 0o700});
const env = {npm_config_cache: join(workspace, 'cache')}, npm = npmPath(); let sequence = 0;
function run(args, cwd) {
  const result = command(args, {cwd, env, log: join(workspace, `install-${++sequence}.log`), timeout: 600000});
  assert.equal(result.status, 'PASS', `Installation step ${sequence} failed; inspect its private log.`); return result.stdout;
}
let archive;
if (supplied) {
  archive = join(workspace, supplied.name); copyFileSync(resolve(values.archive), archive, constants.COPYFILE_EXCL);
} else {
  const packed = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', workspace], packageRoot));
  assert.equal(packed.length, 1); archive = join(workspace, packed[0].filename);
}
const archiveMetadata = inspectArchive(archive, packageRoot, supplied?.sha256), install = join(workspace, 'installation'); mkdirSync(install);
writeFileSync(join(install, 'package.json'), JSON.stringify({name: 'harness-installed-validation', version: '1.0.0', private: true, overrides}), {flag: 'wx'});
run([npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--install-strategy=nested', archive], install);
const installedRoot = realpathSync.native(join(install, 'node_modules/playwright-pom-harness'));
// The runtime resolves the native CLI as a normal dependency; the spike's own install serves only its tests.
for (const prefix of ['examples', 'scripts/spikes/playwright-cli']) run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', join(installedRoot, prefix)], install);
const lock = JSON.parse(readFileSync(join(installedRoot, 'npm-shrinkwrap.json'), 'utf8'));
assert.deepEqual(lock, expectedLock, 'Distributed dependency lock differs from the packed source.');
const dependencies = validateInstalledGraph(install, lock);
const before = snapshotInstalledPackage(install);
const {runChecks} = await import(pathToFileURL(join(installedRoot, 'scripts/ci/checks.mjs')).href);
const checks = runChecks(installedRoot, join(workspace, 'checks'));
const packageUnchanged = JSON.stringify(snapshotInstalledPackage(install)) === JSON.stringify(before);
const result = {version: 1, status: checks.status === 'PASS' && packageUnchanged ? 'PASS' : 'FAIL', platform: process.platform, node: process.version,
  archive: archiveMetadata, dependencies,
  installedEntries: before.length, packageUnchanged, checks};
writeFileSync(join(workspace, 'installed.json'), JSON.stringify(result, null, 2), {flag: 'wx', mode: 0o600});
writeFileSync(join(workspace, 'paths.json'), JSON.stringify({workspace, installedRoot, archive}, null, 2), {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({status: result.status, platform: process.platform, dependencies, packageUnchanged})); if (result.status !== 'PASS') process.exitCode = 1;
