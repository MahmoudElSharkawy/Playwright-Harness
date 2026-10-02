#!/usr/bin/env node
// Release gate: install the actual archive into fresh projects the way users and AIs do, then rerun, clone,
// update, roll back and fail on purpose. Browsers are skipped; npm needs registry access.
// Usage: consumer-flow.mjs <new workspace> [--archive <archive or folder>] [--npm <npm-cli.js>] [--npm-major <n>]
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, realpathSync, chmodSync, cpSync, rmSync, lstatSync, statSync} from 'node:fs';
import {join, resolve, dirname, basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {command, npmPath, hash} from './process.mjs';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {within, realFuture} from '../lib/skill-roots.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';
import {archiveManifest} from '../lib/archive.mjs';

const args = process.argv.slice(2), option = name => {const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1];};
if (!args[0] || args[0].startsWith('--')) throw new Error('Supply a new directory outside the source package: consumer-flow.mjs <workspace> [--archive <path>] [--npm-major <n>]');
const workspace = join(realpathSync.native(dirname(resolve(args[0]))), basename(args[0]));
assert(!within(realpathSync.native(packageRoot), realFuture(workspace)), 'Keep consumer flows outside the source package.');
mkdirSync(join(workspace, 'logs'), {recursive: true, mode: 0o700});

// One fresh npm cache for the run; CI also keeps setup from downloading browsers. --npm selects another npm-cli.js.
const npm = option('--npm') ? realpathSync.native(resolve(option('--npm'))) : npmPath(), npx = join(dirname(npm), 'npx-cli.js');
const env = {npm_config_cache: join(workspace, 'cache'), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false',
  CI: '1', AUTO_ALLURE_OPEN: 'false', PW_TEST_HTML_REPORT_OPEN: 'never'};
let sequence = 0;
const run = (argv, cwd) => command(argv, {cwd, env, timeout: 900000, log: join(workspace, 'logs', `${String(++sequence).padStart(3, '0')}.log`)});
const npmVersion = run([npm, '--version'], workspace).stdout.trim();
if (option('--npm-major')) assert.equal(npmVersion.split('.')[0], option('--npm-major'), `Expected npm ${option('--npm-major')}, found ${npmVersion}.`);

// Archives are packed like releases, with the npm bundled with Node: npm 12 leaves npm-shrinkwrap.json out.
// npm names an unscoped package's archive <name>-<version>.tgz; the shape of `npm pack --json` differs between npm 11 and 12.
function pack(source, destination) {
  const {version} = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')), file = join(destination, `playwright-pom-harness-${version}.tgz`);
  assert.equal(run([npmPath(), 'pack', '--ignore-scripts', '--pack-destination', destination], source).status, 'PASS', 'npm pack failed; inspect its log.');
  assert(existsSync(file), `npm pack did not write ${basename(file)}.`);
  assert([...entries(file)].some(entry => entry.path === 'package/npm-shrinkwrap.json'), 'The packed archive has no npm-shrinkwrap.json; pack releases with npm 11.');
  return file;
}
// The archive under test: given (a file, or the folder installed validation packed into), or packed here.
let archive = option('--archive') && resolve(option('--archive'));
if (archive && statSync(archive).isDirectory()) {
  const found = readdirSync(archive).filter(name => /^playwright-pom-harness-.+\.tgz$/.test(name));
  assert.equal(found.length, 1, 'Expected exactly one archive in the given folder.'); archive = join(archive, found[0]);
}
if (!archive) archive = pack(packageRoot, workspace);
const manifest = archiveManifest(archive), name = `playwright-pom-harness-${manifest.version}.tgz`;
assert.equal(basename(archive), name, 'The archive needs its versioned release name.');
// The release assets: exactly the archive these flows validate, and its checksum.
mkdirSync(join(workspace, 'release'));
copyFileSync(archive, join(workspace, 'release', name));
writeFileSync(join(workspace, 'release', `${name}.sha256`), `${hash(readFileSync(archive))}  ${name}\n`);

const git = (cwd, ...argv) => {
  const result = spawnSync('git', ['-c', 'user.email=consumer-flow@example.test', '-c', 'user.name=Consumer flow', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...argv], {cwd, encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, `git ${argv[0]} failed: ${(result.stderr ?? '').trim().slice(0, 300)}`); return result.stdout;
};
const write = (root, files) => {for (const [file, text] of Object.entries(files)) {mkdirSync(dirname(join(root, file)), {recursive: true}); writeFileSync(join(root, file), text);}};
const project = (id, files = {}) => {const root = join(workspace, id); mkdirSync(root, {recursive: true}); git(root, 'init', '-q'); write(root, files); return root;};
const manifestText = (id, extra = {}) => JSON.stringify({name: id, version: '1.0.0', private: true, ...extra}, null, 2) + '\n';
const commit = (root, message) => {git(root, 'add', '-A'); git(root, 'commit', '-qm', message);};
/** What an AI does: download the archive and its checksum into the project folder. */
const download = (root, file = archive) => {const tgz = join(root, basename(file)); copyFileSync(file, tgz); writeFileSync(`${tgz}.sha256`, `${hash(readFileSync(file))}  ${basename(file)}\n`); return tgz;};
const parse = result => {try {return JSON.parse(result.stdout);} catch {throw new Error(`Expected JSON output (exit ${result.exitCode}); inspect the step log.`);}};
const setup = (root, tgz, extra = []) => parse(run([npx, '--yes', '--package', tgz, 'pom-harness', 'setup', '--skip-browsers', '--json', ...extra], root));
const harness = (root, ...argv) => run([npx, '--no', 'pom-harness', ...argv], root);
const check = root => {const result = harness(root, 'check', '--json'); return {...parse(result), exit: result.exitCode};};
const feature = (report, prefix) => report.features.find(item => item.name.startsWith(prefix))?.status;
const noDrift = report => assert(!report.notes.some(note => note.startsWith('Dependency versions differ')), `Installed dependency closure drifted: ${report.notes.join(' ')}`);
const fingerprint = (root, files) => Object.fromEntries(files.map(file => [file, existsSync(join(root, file)) ? hash(readFileSync(join(root, file))) : null]));
const tracked = root => git(root, 'status', '--porcelain', '--untracked-files=no').trim();
const linked = (root, rel) => realpathSync.native(join(root, rel));
const installedSkill = (root, skill) => realpathSync.native(join(root, 'node_modules/playwright-pom-harness/.agents/skills', skill));
const linkedVersion = (root, skill) => JSON.parse(readFileSync(join(linked(root, `.claude/skills/${skill}`), '../../../package.json'), 'utf8')).version;
const stops = result => JSON.stringify(result.stops ?? result.errors ?? result.status);

/** The entries of an npm archive (ustar, with optional pax path records). */
function* entries(file) {
  const data = gunzipSync(readFileSync(file)), text = (block, start, length) => block.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '');
  let offset = 0, pax;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
    const size = parseInt(text(header, 124, 12).trim() || '0', 8), type = text(header, 156, 1) || '0', body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {pax = Object.fromEntries(body.toString('utf8').split('\n').filter(Boolean).map(line => {const record = line.slice(line.indexOf(' ') + 1), at = record.indexOf('='); return [record.slice(0, at), record.slice(at + 1)];})); continue;}
    if (type === 'g') continue;
    const prefix = text(header, 345, 155), path = pax?.path ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100)); pax = undefined;
    yield {path, type, body};
  }
}
function extract(file, folder) {
  for (const {path, type, body} of entries(file)) {
    const target = resolve(folder, path); assert(within(folder, target), 'An archive entry escapes its folder.');
    if (type === '5') mkdirSync(target, {recursive: true});
    else if (type === '0') {mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, body);}
  }
}
/** The same package under the next patch version, for the update flow. */
function nextArchive() {
  const folder = join(workspace, 'next'), source = join(folder, 'package'), [major, minor, patch] = manifest.version.split(/[.-]/).map(Number), version = `${major}.${minor}.${patch + 1}`;
  mkdirSync(folder); extract(archive, folder);
  for (const file of ['package.json', 'npm-shrinkwrap.json', '.claude-plugin/plugin.json']) {
    const data = JSON.parse(readFileSync(join(source, file), 'utf8')); data.version = version; if (data.packages?.['']) data.packages[''].version = version;
    writeFileSync(join(source, file), JSON.stringify(data, null, 2) + '\n');
  }
  writeFileSync(join(source, 'VERSION'), `${version}\n`);
  return {version, file: pack(source, folder)};
}

const flows = [];
function flow(id, title, body) {
  const started = Date.now();
  try {const details = body(); flows.push({id, title, status: 'PASS', seconds: Math.round((Date.now() - started) / 1000), ...(details ? {details} : {})});}
  catch (error) {flows.push({id, title, status: 'FAIL', seconds: Math.round((Date.now() - started) / 1000), error: String(error?.message ?? error).split('\n')[0].slice(0, 500)});}
  console.log(`${flows.at(-1).status} ${id} ${title}`);
}
const c1 = join(workspace, 'c1-empty'), c2 = join(workspace, 'c2-no-playwright');
let next;

flow('C1', 'An empty folder gets the harness and the starter', () => {
  project('c1-empty'); const result = setup(c1, download(c1));
  assert.equal(result.status, 'DONE', stops(result)); assert.equal(result.checksum, true, 'The published checksum was not verified.');
  assert(result.starter?.includes('playwright.config.ts') && result.starter.includes('src/config/targets.ts'), 'The starter is incomplete.');
  assert(!existsSync(join(c1, name)), 'The downloaded archive stayed in the project folder.');
  const report = check(c1); assert.equal(report.exit, 0, report.errors.join(' ')); noDrift(report);
  for (const prefix of ['skills', 'generation verification']) assert.equal(feature(report, prefix), 'ready', `${prefix} is not ready.`);
  for (const rel of ['.claude/skills/test-data', '.agents/skills/harness-setup']) assert.equal(linked(c1, rel), installedSkill(c1, rel.split('/').pop()));
  assert.equal(run([join(c1, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], c1).status, 'PASS', 'The starter does not typecheck.');
  assert.equal(run([join(c1, 'node_modules/@playwright/test/cli.js'), 'test', '--list', '--pass-with-no-tests'], c1).status, 'PASS', 'The starter cannot list tests.');
  commit(c1, 'Adopt the harness');
  assert(git(c1, 'ls-files', `.harness/vendor/${name}`).trim(), 'The vendored archive is not committed.');
  assert.equal(git(c1, 'ls-files', '.claude/skills', '.agents/skills').trim(), '', 'Skill links or their files were committed.');
  return {starterFiles: result.starter.length, links: result.links};
});
flow('C2', 'A project without Playwright keeps its files and gets the starter', () => {
  project('c2-no-playwright', {'package.json': manifestText('existing-app', {scripts: {start: 'node index.js'}}), 'index.js': 'console.log("app");\n'});
  commit(c2, 'Existing app'); const before = fingerprint(c2, ['index.js']);
  const result = setup(c2, download(c2)); assert.equal(result.status, 'DONE', stops(result)); assert(result.starter?.length, 'The starter was not added.');
  const updated = JSON.parse(readFileSync(join(c2, 'package.json'), 'utf8'));
  assert.equal(updated.name, 'existing-app'); assert.equal(updated.scripts.start, 'node index.js');
  assert.equal(updated.devDependencies['playwright-pom-harness'], `file:.harness/vendor/${name}`); assert.equal(updated.devDependencies['@playwright/test'], '1.63.0');
  assert(updated.scripts.postinstall.includes('playwright-pom-harness/scripts/postinstall.mjs'), 'The link-restoring postinstall is missing.');
  assert.deepEqual(fingerprint(c2, ['index.js']), before);
  const report = check(c2); assert.equal(report.exit, 0, report.errors.join(' ')); noDrift(report);
  commit(c2, 'Adopt the harness'); return {starterFiles: result.starter.length};
});
flow('C3', 'An existing Playwright framework gets only the integration', () => {
  const files = {'playwright.config.ts': "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n",
    'tests/home.spec.ts': "import { test } from '@playwright/test';\ntest('home', async () => {});\n"};
  const root = project('c3-framework', {'package.json': manifestText('existing-framework', {devDependencies: {'@playwright/test': '1.63.0'}}), ...files});
  commit(root, 'Existing framework'); const before = fingerprint(root, Object.keys(files));
  const result = setup(root, download(root)); assert.equal(result.status, 'DONE', stops(result));
  assert.equal(result.starter, undefined); assert(!existsSync(join(root, 'src/config')), 'The starter was added to an existing framework.');
  assert.deepEqual(fingerprint(root, Object.keys(files)), before);
  const report = check(root); assert.equal(report.exit, 0, report.errors.join(' ')); noDrift(report);
  assert.equal(run([join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--list'], root).status, 'PASS', 'The framework no longer lists its tests.');
  return {changed: result.changed.length};
});
flow('C4', 'A rerun changes nothing', () => {
  assert(existsSync(join(c1, '.harness/links.json')), 'Needs C1.');
  const result = parse(harness(c1, 'setup', '--skip-browsers', '--json')); assert.equal(result.status, 'DONE', stops(result));
  assert.deepEqual(result.changed, []); assert.equal(git(c1, 'status', '--porcelain').trim(), '');
});
flow('C5', 'A CRLF clone restores the links with npm ci', () => {
  const clone = join(workspace, 'c5-clone'); git(workspace, 'clone', '-q', '-c', 'core.autocrlf=true', c1, clone);
  assert(readFileSync(join(clone, 'package.json'), 'utf8').includes('\r\n'), 'The clone was not checked out with CRLF.');
  assert(!existsSync(join(clone, '.claude/skills/test-data')), 'A skill link was committed.');
  assert.equal(run([npm, 'ci'], clone).status, 'PASS', 'npm ci failed in the clone.');
  assert.equal(linked(clone, '.claude/skills/test-data'), installedSkill(clone, 'test-data'));
  const report = check(clone); assert.equal(report.exit, 0, report.errors.join(' ')); assert.equal(feature(report, 'skills'), 'ready'); noDrift(report);
  const rerun = parse(harness(clone, 'setup', '--skip-browsers', '--json')); assert.equal(rerun.status, 'DONE', stops(rerun)); assert.deepEqual(rerun.changed, []);
  assert.equal(git(clone, 'status', '--porcelain').trim(), '');
});
flow('F3', 'check flags a pipeline that runs Playwright tests without installing a browser', () => {
  const pipeline = 'steps:\n  - script: npm ci\n  - script: npx playwright test\n';
  write(c2, {'azure-pipelines.yml': pipeline}); assert.equal(feature(check(c2), 'CI pipeline'), 'unavailable');
  write(c2, {'azure-pipelines.yml': pipeline.replace('  - script: npx playwright test', '  - script: npx playwright install --with-deps chromium\n  - script: npx playwright test')});
  assert.equal(feature(check(c2), 'CI pipeline'), 'ready'); rmSync(join(c2, 'azure-pipelines.yml'));
});
flow('C6', 'An update to the next archive replaces the vendored archive and keeps the project', () => {
  assert(existsSync(join(c1, '.harness/links.json')), 'Needs C1.'); next = nextArchive();
  const result = setup(c1, download(c1, next.file)); assert.equal(result.status, 'DONE', stops(result));
  assert.equal(result.previousVersion, manifest.version); assert.equal(result.version, next.version);
  assert.deepEqual(readdirSync(join(c1, '.harness/vendor')), [basename(next.file)]);
  assert.equal(JSON.parse(readFileSync(join(c1, 'package-lock.json'), 'utf8')).packages['node_modules/playwright-pom-harness'].version, next.version);
  const report = check(c1); assert.equal(report.exit, 0, report.errors.join(' ')); noDrift(report);
  commit(c1, 'Update the harness'); assert.equal(git(c1, 'status', '--porcelain').trim(), '');
  return {from: manifest.version, to: next.version};
});
flow('C9', 'Two projects on different versions each use their own installation', () => {
  assert(next, 'Needs C6.');
  assert.equal(linkedVersion(c1, 'test-data'), next.version); assert.equal(linkedVersion(c2, 'test-data'), manifest.version);
  for (const [root, version] of [[c1, next.version], [c2, manifest.version]]) {
    assert.equal(check(root).exit, 0); assert(harness(root, 'help').stdout.includes(`pom-harness ${version}`), `The CLI in ${basename(root)} is not ${version}.`);
  }
});
flow('C7', 'A rollback across the old layout keeps project data and writes nothing through links', () => {
  const root = project('c7-old-layout', {'package.json': manifestText('old-layout')});
  assert.equal(run([npm, 'install'], root).status, 'PASS', 'Creating the lockfile failed.');
  // The old layout: copied .claude/skills folders (the 3.0.x redirects) holding team data.
  const legacy = readdirSync(join(packageRoot, '.claude/skills'), {withFileTypes: true}).filter(entry => entry.isDirectory() && entry.name !== 'harness-setup').map(entry => entry.name);
  for (const skill of legacy) cpSync(join(packageRoot, '.claude/skills', skill), join(root, '.claude/skills', skill), {recursive: true});
  const data = {'.claude/skills/framework-review/class-ledger.md': '# Class ledger\n\n- Synthetic team finding: locator suffixes.\n',
    '.claude/skills/automate-suite/references/prerequisite-dictionary.md': '# Prerequisites\n\n- A synthetic approved customer exists before quoting.\n',
    '.claude/skills/plan-tracker/data/history.jsonl': '{"event":"synthetic","case":101}\n', '.claude/skills/plan-tracker/data/plan-77.json': '{"plan":77,"cases":[]}\n'};
  write(root, data); commit(root, 'Old layout');
  const result = setup(root, download(root)); assert.equal(result.status, 'DONE', stops(result));
  commit(root, 'Adopt the harness');
  const installed = join(root, 'node_modules/playwright-pom-harness'), before = JSON.stringify(snapshotInstalledPackage(installed));
  assert.equal(harness(root, 'unlink').status, 'PASS', 'unlink failed.');
  git(root, 'revert', '--no-edit', 'HEAD');
  assert.equal(JSON.stringify(snapshotInstalledPackage(installed)), before, 'The rollback wrote into node_modules.');
  assert.equal(run([npm, 'ci'], root).status, 'PASS', 'npm ci failed after the revert.');
  for (const [file, text] of Object.entries(data)) assert.equal(readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n'), text, `${file} changed.`);
  for (const skill of legacy) {
    const entry = lstatSync(join(root, '.claude/skills', skill));
    assert(entry.isDirectory() && !entry.isSymbolicLink() && existsSync(join(root, '.claude/skills', skill, 'SKILL.md')), `${skill} is not back as a project folder.`);
  }
  assert(!existsSync(installed), 'npm ci left the harness installed.'); assert.equal(tracked(root), '');
  return {legacyFolders: legacy.length, replaced: result.removedFolders.length, reported: result.reports.length};
});
flow('F1', 'A conflict found in preflight stops before anything changes', () => {
  const edited = '<!-- playwright-pom-harness -->\nTeam-edited harness rules.\n<!-- /playwright-pom-harness -->\n';
  const root = project('f1-conflict', {'package.json': manifestText('f1-conflict'), 'AGENTS.md': `# Team rules\n\n${edited}`});
  assert.equal(run([npm, 'install'], root).status, 'PASS', 'Creating the lockfile failed.'); commit(root, 'Existing project');
  const watched = ['package.json', 'package-lock.json', 'AGENTS.md'], before = fingerprint(root, watched);
  const modules = () => existsSync(join(root, 'node_modules')) ? readdirSync(join(root, 'node_modules')).sort() : [], modulesBefore = modules();
  const result = setup(root, download(root)); assert.equal(result.status, 'STOPPED', stops(result));
  assert.match(result.stops.join('\n'), /edited harness instruction block in AGENTS\.md/);
  assert.deepEqual(fingerprint(root, watched), before); assert.deepEqual(modules(), modulesBefore); assert(!existsSync(join(root, '.harness')), 'Setup wrote before stopping.');
});
flow('F2', 'A failure after install is reported, completes on a rerun, and restores the exact previous state', () => {
  const failed = id => {
    const root = project(id, {'package.json': manifestText(id), 'AGENTS.md': '# Team rules\n'});
    assert.equal(run([npm, 'install'], root).status, 'PASS', 'Creating the lockfile failed.'); commit(root, 'Existing project');
    // An uncommitted change that both recoveries must keep, then a write that stage 2 cannot make.
    write(root, {'package.json': manifestText(id, {description: 'uncommitted change'})}); const before = fingerprint(root, ['package.json', 'package-lock.json', 'AGENTS.md']);
    chmodSync(join(root, 'AGENTS.md'), 0o444);
    const result = setup(root, download(root)); chmodSync(join(root, 'AGENTS.md'), 0o644);
    assert.equal(result.status, 'FAILED', stops(result)); assert.match((result.recovery ?? []).join(' '), /setup --restore/);
    return {root, before};
  };
  const rerun = failed('f2-rerun'), done = parse(harness(rerun.root, 'setup', '--skip-browsers', '--json'));
  assert.equal(done.status, 'DONE', stops(done)); assert.equal(JSON.parse(readFileSync(join(rerun.root, 'package.json'), 'utf8')).description, 'uncommitted change');
  const restore = failed('f2-restore'), restored = parse(harness(restore.root, 'setup', '--restore', '--json'));
  assert.equal(restored.status, 'RESTORED', stops(restored));
  assert.deepEqual(fingerprint(restore.root, ['package.json', 'package-lock.json', 'AGENTS.md']), restore.before);
  assert(!existsSync(join(restore.root, '.harness')), 'The restore left harness state behind.'); assert(!existsSync(join(restore.root, 'node_modules/playwright-pom-harness')), 'The restore left the harness installed.');
});
flow('C8', 'An empty folder under a parent package.json needs an explicit project root', () => {
  const parent = join(workspace, 'c8-parent'), root = join(parent, 'tests'), parentManifest = manifestText('c8-parent');
  mkdirSync(root, {recursive: true}); writeFileSync(join(parent, 'package.json'), parentManifest); git(root, 'init', '-q'); const tgz = download(root);
  const stopped = setup(root, tgz); assert.equal(stopped.status, 'STOPPED', stops(stopped)); assert.match(stopped.stops.join(' '), /--project-root \./);
  const done = setup(root, tgz, ['--project-root', '.']); assert.equal(done.status, 'DONE', stops(done));
  assert.equal(readFileSync(join(parent, 'package.json'), 'utf8'), parentManifest); assert(!existsSync(join(parent, 'node_modules')), 'npm installed into the parent.');
  assert.equal(check(root).exit, 0);
});

const expected = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'F1', 'F2', 'F3'];
const status = flows.length === expected.length && flows.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
const result = {version: 1, status, platform: process.platform, node: process.version, npm: npmVersion, archive: {name, sha256: hash(readFileSync(archive))}, flows};
writeFileSync(join(workspace, 'consumer-flow.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({status, platform: process.platform, npm: npmVersion, flows: flows.map(item => `${item.id} ${item.status}`)}));
if (status !== 'PASS') process.exitCode = 1;
