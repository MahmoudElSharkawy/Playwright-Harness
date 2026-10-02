import {existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, realpathSync, rmSync} from 'node:fs';
import {join, dirname, basename, resolve, relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageRoot as runningPackage, consumerRoots, consumerPath} from './consumer-paths.mjs';
import {adoptProject, AdoptionConflict, LINKS_FILE, DISCOVERY_DIRS, isPointer, rootsPointer} from './adoption.mjs';
import {discoveryEntry, harnessSkillTarget, createSkillLink, removeSkillLink} from './skill-roots.mjs';
import {archiveManifest, sha256} from './archive.mjs';
import {npmPath} from './npm.mjs';
import {startJournal, openJournal, latestJournal, restoreJournal} from './setup-journal.mjs';
import {nativeCliInstallation} from './browser/native-cli.mjs';
import {runCheck} from './check.mjs';

export const VERSION = JSON.parse(readFileSync(join(runningPackage, 'package.json'), 'utf8')).version;
const posix = path => path.replaceAll('\\', '/');
const readJsonFile = file => JSON.parse(readFileSync(file, 'utf8'));
// The minimal starter: run configuration and the technical utils, no demo pages or tests.
const STARTER_FILES = ['playwright.config.ts', 'global-setup.ts', 'allurerc.json', 'tsconfig.json',
  'src/config/applications.ts', 'src/config/databases.ts', 'src/config/reporting.ts', 'src/config/targets.ts', 'src/config/timeouts.ts',
  'src/utils/AllureReport.ts', 'src/utils/ApiActions.ts', 'src/utils/DBActions.ts', 'src/utils/Expects.ts', 'src/utils/UiControls.ts'];
const STARTER_DEPENDENCIES = ['@playwright/test', 'playwright', '@types/node', 'typescript', 'dotenv', 'allure', 'allure-playwright',
  'allure-js-commons', 'playwright-ctrf-json-reporter', 'mssql', '@types/mssql'];
// Git-ignored files each machine writes for itself; the summary lists only what the user reviews and commits.
const machineLocal = file => ['.harness/state/', '.harness/runs/', '.harness/knowledge-candidates/'].some(prefix => file.startsWith(prefix))
  || file === '.harness/installation.json' || DISCOVERY_DIRS.some(dir => file === `${dir}/ROOTS.md`);
// Restores links after npm install; it never fails the install, and does nothing without the harness.
export const POSTINSTALL = `node -e "import('playwright-pom-harness/scripts/postinstall.mjs').catch(()=>{})"`;

/** Runs the npm that launched us (or Node's bundled npm) without a shell; never npm.cmd. */
export const defaultNpm = cwd => args => {
  const result = spawnSync(process.execPath, [npmPath(), ...args], {cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024});
  return {status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}`};
};
const git = (cwd, ...args) => spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true});

/** The project this package is installed into, when it sits in npm's default layout. */
export function installedProject(packageRoot = runningPackage) {
  return basename(packageRoot) === 'playwright-pom-harness' && basename(dirname(packageRoot)) === 'node_modules' ? dirname(dirname(packageRoot)) : undefined;
}
/** Commands act only as the project's own installation: npm's place for it, and the version the lockfile records. */
export function verifyInstallation(packageRoot = runningPackage) {
  const projectRoot = installedProject(packageRoot);
  if (!projectRoot) throw new Error('This pom-harness is not installed in a project. Run it from the project folder with "npx --no pom-harness".');
  const lock = join(projectRoot, 'package-lock.json'), entry = existsSync(lock) ? readJsonFile(lock).packages?.['node_modules/playwright-pom-harness'] : undefined;
  if (entry?.version !== VERSION) throw new Error(`The project lockfile records playwright-pom-harness ${entry?.version ?? 'nothing'}, not ${VERSION}; run npm ci.`);
  return projectRoot;
}
export function preconditions(projectRoot, {explicitRoot = false} = {}) {
  const stops = [], warnings = [];
  if (Number(process.versions.node.split('.')[0]) !== 24) stops.push(`Use Node 24; this is Node ${process.versions.node}.`);
  for (const file of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) if (existsSync(join(projectRoot, file))) stops.push(`${file} found; this harness installs with npm only.`);
  let outer = dirname(projectRoot);
  while (outer !== dirname(outer) && !existsSync(join(outer, 'package.json'))) outer = dirname(outer);
  if (existsSync(join(outer, 'package.json'))) {
    let workspaces; try {workspaces = readJsonFile(join(outer, 'package.json')).workspaces;} catch {/* An unreadable parent manifest is not a workspace. */}
    if (workspaces) stops.push(`${outer} is an npm workspace root; adopting a workspace member is not supported.`);
    else if (!existsSync(join(projectRoot, 'package.json')) && !explicitRoot) stops.push(`There is no package.json here, but ${outer} has one, so npm would install there. Pass --project-root . to adopt this folder.`);
  }
  if (git(projectRoot, 'rev-parse', '--is-inside-work-tree').status !== 0) warnings.push('This folder is not a git repository, so the changes cannot be reviewed as a diff.');
  return {stops, warnings};
}
/** The archive this command was started from: --archive, the spec npx recorded, or one matching file in the project. */
export function locateArchive(projectRoot, explicit, packageRoot = runningPackage) {
  const matches = file => {try {const manifest = archiveManifest(file); return manifest.name === 'playwright-pom-harness' && manifest.version === VERSION;} catch {return false;}};
  if (explicit) {
    const file = resolve(explicit);
    if (!existsSync(file) || !matches(file)) throw new Error(`${explicit} is not the playwright-pom-harness ${VERSION} archive. For another version run: npx --yes --package "<full path to that archive>" pom-harness setup`);
    return file;
  }
  // npx installs into <cache>/_npx/<hash>/node_modules and records the archive spec there; no other layout counts.
  const npxRoot = dirname(dirname(packageRoot));
  if (basename(dirname(npxRoot)) === '_npx') {
    try {
      const spec = readJsonFile(join(npxRoot, 'package.json')).dependencies?.['playwright-pom-harness'];
      if (spec?.startsWith('file:') && matches(resolve(npxRoot, spec.slice(5)))) return resolve(npxRoot, spec.slice(5));
    } catch {/* npx recorded no readable archive spec. */}
  }
  const found = readdirSync(projectRoot).filter(name => /^playwright-pom-harness-.+\.tgz$/.test(name)).map(name => join(projectRoot, name)).filter(matches);
  if (found.length === 1) return found[0];
  throw new Error(found.length ? `Several playwright-pom-harness ${VERSION} archives are in the project folder; pass --archive <path>.` : `Cannot find the playwright-pom-harness ${VERSION} archive; pass --archive <path>.`);
}
function verifyChecksum(archive) {
  const file = `${archive}.sha256`; if (!existsSync(file)) return false;
  if (readFileSync(file, 'utf8').trim().split(/\s+/)[0]?.toLowerCase() !== sha256(archive)) throw new Error(`${basename(archive)} does not match ${basename(file)}; download both files again.`);
  return true;
}
export function hasPlaywrightFramework(projectRoot) {
  const manifest = existsSync(join(projectRoot, 'package.json')) ? readJsonFile(join(projectRoot, 'package.json')) : {};
  return Boolean(manifest.dependencies?.['@playwright/test'] ?? manifest.devDependencies?.['@playwright/test']) || readdirSync(projectRoot).some(name => /^playwright\.config\.[cm]?[jt]s$/.test(name));
}
function starterDependencies(packageRoot, projectRoot) {
  const locked = readJsonFile(join(packageRoot, 'examples/package-lock.json')).packages;
  const manifest = existsSync(join(projectRoot, 'package.json')) ? readJsonFile(join(projectRoot, 'package.json')) : {};
  const present = {...manifest.dependencies, ...manifest.devDependencies}, install = [], kept = [];
  for (const name of STARTER_DEPENDENCIES) {
    const version = locked[`node_modules/${name}`].version;
    if (present[name] === undefined) install.push(`${name}@${version}`);
    else if (present[name] !== version) kept.push(`${name} ${present[name]} (the starter is validated with ${version})`);
  }
  return {install, kept};
}
const npmName = folder => basename(folder).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[-.]+$/g, '').slice(0, 214) || 'playwright-tests';

/** Stage 1, started from the archive by npx: check everything, then install, then hand over. */
export function setupFromArchive({projectRoot, archive, environment, mode, skipBrowsers = false, explicitRoot = false, dryRun = false, npm = defaultNpm(projectRoot), handoff = defaultHandoff, packageRoot = runningPackage}) {
  projectRoot = resolve(projectRoot);
  const {stops, warnings} = preconditions(projectRoot, {explicitRoot});
  if (stops.length) return {status: 'STOPPED', stops, warnings};
  let file, checksum;
  try {file = locateArchive(projectRoot, archive, packageRoot); checksum = verifyChecksum(file);} catch (error) {return {status: 'STOPPED', stops: [error.message], warnings};}
  const vendored = `.harness/vendor/playwright-pom-harness-${VERSION}.tgz`, vendorPath = join(projectRoot, vendored);
  if (existsSync(vendorPath) && sha256(vendorPath) !== sha256(file)) return {status: 'STOPPED', warnings, stops: [`${vendored} already exists with different bytes; remove it only if you are sure, then rerun.`]};
  // Preflight with no writes: the new version plans its whole adoption first.
  let plan;
  try {plan = adoptProject({projectRoot, installedRoot: packageRoot, environment, mode, dryRun: true});}
  catch (error) {return {status: 'STOPPED', warnings, stops: error instanceof AdoptionConflict ? error.conflicts : [error.message]};}
  if (dryRun) return {status: 'PLANNED', version: VERSION, archive: file, checksum, warnings, changes: plan.changes.map(change => change.file), links: summarizeLinks(plan.links), reports: plan.reports, starter: !hasPlaywrightFramework(projectRoot)};
  const roots = consumerRoots(projectRoot, packageRoot), lockPath = join(projectRoot, 'package-lock.json');
  const previousVersion = existsSync(lockPath) ? readJsonFile(lockPath).packages?.['node_modules/playwright-pom-harness']?.version : undefined;
  const starter = !hasPlaywrightFramework(projectRoot), dependencies = starter ? starterDependencies(packageRoot, projectRoot) : {install: [], kept: []};
  const journal = startJournal(roots, {previousVersion: previousVersion ?? null, newVersion: VERSION, starter});
  for (const path of ['package.json', 'package-lock.json']) journal.file(path, existsSync(join(projectRoot, path)) ? readFileSync(join(projectRoot, path)) : null);
  journal.modules(existsSync(join(projectRoot, 'node_modules')));
  if (!existsSync(join(projectRoot, 'package.json'))) writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({name: npmName(projectRoot), version: '1.0.0', private: true, type: 'commonjs', engines: {node: '>=24 <25'}, scripts: {test: 'playwright test'}}, null, 2) + '\n');
  if (resolve(file) !== resolve(vendorPath)) {journal.file(vendored, existsSync(vendorPath) ? readFileSync(vendorPath) : null); mkdirSync(dirname(vendorPath), {recursive: true}); copyFileSync(file, vendorPath);}
  const installed = npm(['install', '--save-dev', '--save-exact', '--no-audit', '--no-fund', `file:${vendored}`, ...dependencies.install]);
  if (installed.status !== 0) {
    const restore = restoreJournal(roots, journal, {npm, modules: false});
    return {status: 'FAILED', warnings, stops: ['npm install did not complete; its last output is shown below.'], output: installed.output.trim().split('\n').slice(-12).join('\n'),
      restored: restore.restored, notes: ['package.json, the lockfile and the copied archive were restored. node_modules and anything the project\'s own install scripts did may have changed; run npm ci (or npm install when there was no lockfile).']};
  }
  const download = relative(projectRoot, file);
  return handoff({projectRoot, run: journal.run, environment, mode, skipBrowsers, starter, checksum, warnings, kept: dependencies.kept,
    download: !download.startsWith('..') && posix(download) !== vendored ? posix(download) : undefined});
}
/** Runs stage 2 in the freshly installed copy, so the new version performs its own migration.
 * Its console stays visible (browser downloads); the result comes back through the run's journal.
 */
function defaultHandoff({projectRoot, run, environment, mode, skipBrowsers, starter, checksum, warnings, kept, download}) {
  const cli = join(projectRoot, 'node_modules/playwright-pom-harness/scripts/cli.mjs');
  const args = [cli, 'setup', '--configure', run, ...(environment ? ['--environment', environment] : []), ...(mode ? ['--mode', mode] : []),
    ...(skipBrowsers ? ['--skip-browsers'] : []), ...(starter ? ['--starter'] : []), ...(download ? ['--download', download] : [])];
  spawnSync(process.execPath, args, {cwd: projectRoot, stdio: 'inherit', windowsHide: true, env: {...process.env, POM_HARNESS_SETUP_NOTES: JSON.stringify({checksum, warnings, kept})}});
  const result = join(projectRoot, '.harness/state/setup', run, 'result.json');
  return existsSync(result) ? readJsonFile(result) : {status: 'FAILED', stops: ['The installed harness did not complete setup.'], journal: run,
    recovery: ['rerun "npx --no pom-harness setup"', 'or run "npx --no pom-harness setup --restore"']};
}
/** Stage 2's result, kept beside its journal for the bootstrap that started it. */
export function writeResult(projectRoot, run, result) {
  writeFileSync(join(projectRoot, '.harness/state/setup', run, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

/** The installed copy's preview of a repair or new environment: the adoption plan, nothing written. */
export function planInstalled({projectRoot, environment, mode, packageRoot = runningPackage}) {
  try {
    const plan = adoptProject({projectRoot: resolve(projectRoot), installedRoot: packageRoot, environment, mode, dryRun: true});
    return {status: 'PLANNED', version: VERSION, changes: plan.changes.map(change => change.file), links: summarizeLinks(plan.links), reports: plan.reports};
  } catch (error) {return {status: 'STOPPED', stops: error instanceof AdoptionConflict ? error.conflicts : [error.message]};}
}

/** Stage 2, in the installed copy: adopt, add the starter, wire teammates, download browsers, report. */
export function configureInstalled({projectRoot, run, environment, mode, skipBrowsers = false, starter = false, download, carried = {}, packageRoot = runningPackage}) {
  projectRoot = resolve(projectRoot);
  const roots = consumerRoots(projectRoot, packageRoot), journal = run ? openJournal(roots, run) : startJournal(roots, {previousVersion: null, newVersion: VERSION});
  const recovery = ['rerun "npx --no pom-harness setup" (it is idempotent)', 'or run "npx --no pom-harness setup --restore" to return to the state before this run'];
  let adoption;
  try {adoption = adoptProject({projectRoot, installedRoot: packageRoot, environment, mode, journal});}
  catch (error) {return {status: 'FAILED', stops: error instanceof AdoptionConflict ? error.conflicts : [error.message], recovery, journal: journal.run};}
  try {
    const seeded = [];
    if (starter) {
      for (const [file, source] of [...STARTER_FILES.map(file => [file, join(packageRoot, 'examples', file)]), ['.env.example', join(packageRoot, '.env.example')], ['README.md', join(packageRoot, 'examples/README.runbook.md')]]) {
        const target = join(projectRoot, file); if (existsSync(target)) continue;
        journal.file(file, null); mkdirSync(dirname(target), {recursive: true}); copyFileSync(source, target); seeded.push(file);
      }
    }
    const changed = [...adoption.changes.map(change => change.file).filter(file => !machineLocal(file)), ...seeded];
    // Teammates: npm install restores the links through a guarded postinstall.
    const manifestPath = join(projectRoot, 'package.json'), manifestText = readFileSync(manifestPath, 'utf8'), manifest = JSON.parse(manifestText);
    const current = manifest.scripts?.postinstall;
    if (!current?.includes(POSTINSTALL)) {
      journal.file('package.json', Buffer.from(manifestText));
      manifest.scripts = {...manifest.scripts, postinstall: current ? `${POSTINSTALL} && ${current}` : POSTINSTALL};
      const indent = manifestText.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? '  ', eol = manifestText.includes('\r\n') ? '\r\n' : '\n';
      writeFileSync(manifestPath, (JSON.stringify(manifest, null, indent) + '\n').replaceAll('\n', eol)); changed.push('package.json');
    }
    // The committed archive must stay tracked even under a broad *.tgz rule.
    const vendored = `.harness/vendor/playwright-pom-harness-${VERSION}.tgz`, notes = [];
    if (git(projectRoot, 'rev-parse', '--is-inside-work-tree').status === 0 && git(projectRoot, 'check-ignore', '-q', vendored).status === 0) {
      appendLine(projectRoot, '.gitignore', '!/.harness/vendor/*.tgz', journal); changed.push('.gitignore');
      if (git(projectRoot, 'check-ignore', '-q', vendored).status === 0) notes.push(`${vendored} is still git-ignored, probably because a rule ignores its folder; adjust .gitignore so it is committed.`);
    }
    if (appendLine(projectRoot, '.gitattributes', '/.harness/vendor/*.tgz binary', journal)) changed.push('.gitattributes');
    // Older vendored archives and the downloaded copy move into the journal, so a restore can bring them back.
    for (const name of existsSync(join(projectRoot, '.harness/vendor')) ? readdirSync(join(projectRoot, '.harness/vendor')) : []) {
      if (/^playwright-pom-harness-.+\.tgz$/.test(name) && `.harness/vendor/${name}` !== vendored) journal.moved(`.harness/vendor/${name}`, join(projectRoot, '.harness/vendor', name));
    }
    for (const file of download ? [download, `${download}.sha256`] : []) if (existsSync(join(projectRoot, file))) journal.moved(file, join(projectRoot, file));
    const browsers = installBrowsers(projectRoot, roots, {skip: skipBrowsers || Boolean(process.env.CI), packageRoot, journal});
    const readiness = runCheck({projectRoot, packageRoot});
    const previousVersion = journal.record.previousVersion ?? undefined;
    return {status: readiness.errors.length ? 'INCOMPLETE' : 'DONE', version: VERSION, previousVersion, journal: journal.run, changed: [...new Set(changed)],
      links: summarizeLinks(adoption.links), removedFolders: adoption.removedFolders, reports: adoption.reports, starter: starter ? seeded : undefined,
      browsers, readiness: readiness.features, errors: readiness.errors, notes: [...(carried.warnings ?? []), ...notes, ...readiness.notes, ...(carried.kept?.length ? [`Kept your versions: ${carried.kept.join(', ')}.`] : [])],
      checksum: carried.checksum ?? false, upgradeActions: upgradeActions(previousVersion, VERSION, join(packageRoot, 'CHANGELOG.md')), next: nextSteps(starter)};
  } catch (error) {return {status: 'FAILED', stops: [error.message], recovery, journal: journal.run};}
}
function appendLine(projectRoot, file, line, journal) {
  const path = join(projectRoot, file), text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (text.split(/\r?\n/).includes(line)) return false;
  journal.file(file, existsSync(path) ? Buffer.from(text) : null);
  writeFileSync(path, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`); return true;
}
function summarizeLinks(links) {
  const count = kind => links.filter(link => link.kind === kind).length;
  return {created: count('create'), repaired: count('repair'), removed: count('remove')};
}
/** Downloads are warnings, never failures: a missing browser makes that feature unavailable. */
function installBrowsers(projectRoot, roots, {skip, packageRoot, journal}) {
  const status = {harness: 'skipped', project: 'skipped', at: new Date().toISOString()};
  if (!skip) {
    const run = script => spawnSync(process.execPath, [script, 'install', 'chromium'], {cwd: projectRoot, stdio: 'inherit', windowsHide: true}).status === 0 ? 'installed' : 'failed';
    try {status.harness = run(nativeCliInstallation(packageRoot).installer);} catch {status.harness = 'failed';}
    const projectCli = join(projectRoot, 'node_modules/@playwright/test/cli.js');
    status.project = existsSync(projectCli) ? run(projectCli) : 'not installed';
  }
  const file = consumerPath(roots, '.harness/state/setup/browsers.json'); mkdirSync(dirname(file), {recursive: true});
  const previous = existsSync(file) ? readJsonFile(file) : {}; journal.file('.harness/state/setup/browsers.json', existsSync(file) ? readFileSync(file) : null);
  // A skipped run keeps an earlier successful download on record.
  writeFileSync(file, JSON.stringify({...previous, ...Object.fromEntries(Object.entries(status).filter(([, value]) => value !== 'skipped'))}, null, 2) + '\n');
  return status;
}
const compare = (left, right) => {const a = left.split(/[.-]/).map(Number), b = right.split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0;};
/** The CHANGELOG "### Upgrade actions" of every version after the previous one, up to this one. */
export function upgradeActions(previousVersion, version, changelog = join(runningPackage, 'CHANGELOG.md')) {
  if (!existsSync(changelog)) return [];
  const actions = [];let current, inActions = false;
  for (const line of readFileSync(changelog, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/^## (\d+\.\d+\.\d+)\b/);
    if (heading) {current = heading[1]; inActions = false; continue;}
    if (/^## /.test(line)) {current = undefined; inActions = false; continue;}
    if (/^### /.test(line)) {inActions = /^### Upgrade actions\s*$/.test(line); continue;}
    if (inActions && current && /^- /.test(line) && compare(current, version) <= 0 && (!previousVersion || compare(current, previousVersion) > 0)) actions.push(`${current}: ${line.slice(2)}`);
  }
  return actions;
}
const nextSteps = starter => [
  'Review the changes (git diff) and commit them, including the archive under .harness/vendor.',
  'If the skills do not appear yet, run /reload-skills in Claude Code or restart Codex.',
  starter ? 'The starter has no tests yet; ask the AI to configure the harness with your project information and automate your first scenarios.' : 'Ask the AI to configure the harness with your project information.',
];

/** Recreates the managed links and pointers after npm install, from the committed record only. */
export function restoreLinks(projectRoot = process.cwd(), packageRoot = runningPackage) {
  const roots = consumerRoots(projectRoot, packageRoot);
  if (installedProject(packageRoot) !== roots.projectRoot) return {skipped: 'not installed in this project'};
  const record = consumerPath(roots, LINKS_FILE);
  if (!existsSync(record)) return {skipped: 'setup has not run here'};
  const {links = [], files = []} = readJsonFile(record), restored = [], problems = [];
  for (const rel of links) {
    const name = rel.split('/').pop(), source = join(packageRoot, '.agents/skills', name), path = join(roots.projectRoot, rel), entry = discoveryEntry(path);
    if (!existsSync(join(source, 'SKILL.md'))) continue; // A skill this version no longer ships; setup tidies it.
    if (entry.kind === 'link' && entry.live && realpathSync(path) === realpathSync(source)) continue;
    if (entry.kind === 'missing') {createSkillLink(source, path); restored.push(rel);}
    else if (entry.kind === 'link' && (!entry.live || harnessSkillTarget(entry, name))) {removeSkillLink(path); createSkillLink(source, path); restored.push(rel);}
    else problems.push(rel);
  }
  for (const file of files) {
    const target = consumerPath(roots, file), expected = rootsPointer(roots, dirname(file));
    if (!existsSync(target) || (isPointer(readFileSync(target, 'utf8')) && readFileSync(target, 'utf8') !== expected)) {mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, expected); restored.push(file);}
    else if (!isPointer(readFileSync(target, 'utf8'))) problems.push(file);
  }
  return {restored, problems};
}
/** Removes only verified harness links and pointer files, before a rollback or a checkout of the old layout. */
export function unlinkHarness(projectRoot, packageRoot = runningPackage) {
  const roots = consumerRoots(projectRoot, packageRoot), record = consumerPath(roots, LINKS_FILE), removed = [], kept = [];
  if (!existsSync(record)) return {removed, kept};
  const {links = [], files = []} = readJsonFile(record);
  for (const rel of links) {
    const path = join(roots.projectRoot, rel), entry = discoveryEntry(path);
    if (entry.kind === 'link' && (!entry.live || harnessSkillTarget(entry, rel.split('/').pop()))) {removeSkillLink(path); removed.push(rel);}
    else if (entry.kind !== 'missing') kept.push(rel);
  }
  for (const file of files) {
    const target = consumerPath(roots, file);
    if (existsSync(target) && isPointer(readFileSync(target, 'utf8'))) {rmSync(target); removed.push(file);}
  }
  return {removed, kept};
}
/** Undoes the most recent setup run from its journal. */
export function restoreLastRun(projectRoot, {npm = defaultNpm(projectRoot), packageRoot = runningPackage} = {}) {
  const roots = consumerRoots(projectRoot, packageRoot), journal = latestJournal(roots);
  if (!journal) return {status: 'STOPPED', stops: ['No setup run is recorded here.']};
  if (journal.record.restored) return {status: 'STOPPED', stops: [`The last setup run (${journal.run}) was already restored.`]};
  return {status: 'RESTORED', journal: journal.run, ...restoreJournal(roots, journal, {npm})};
}
