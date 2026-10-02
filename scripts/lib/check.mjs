import {existsSync, readFileSync, readdirSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {consumerRoots, consumerPath} from './consumer-paths.mjs';
import {discoveryEntry} from './skill-roots.mjs';
import {LINKS_FILE} from './adoption.mjs';
import {readJson, validateConfiguration} from './project-config.mjs';
import {consumerEnvironment} from './consumer-env.mjs';
import {loadAdoConfiguration} from './integrations/config.mjs';
import {nativeCliInstallation} from './browser/native-cli.mjs';
import {integrity} from './archive.mjs';

export const READY = 'ready', UNAVAILABLE = 'unavailable', WAITING = 'waiting for project data', OPTIONAL = 'not configured';
const GENERATION_PLAYWRIGHT = '1.63.0', ALLURE = {allure: '3.19.1', 'allure-playwright': '3.13.0', 'allure-js-commons': '3.13.0'};
// Type declarations follow the project's own @types/node; their versions never change runtime behaviour.
const TYPES_ONLY = name => name.startsWith('@types/') || name === 'undici-types';
const installedVersion = (projectRoot, name) => {try {return JSON.parse(readFileSync(join(projectRoot, 'node_modules', name, 'package.json'), 'utf8')).version;} catch {return undefined;}};
const git = (cwd, ...args) => spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true});

/** Per-feature readiness. Secret values are never printed or persisted; only names are reported.
 * Errors (exit 1) are reserved for a broken installation or invalid configuration, so a CI run
 * without secrets still passes; missing data and optional features are reported, not failed.
 */
export function runCheck({projectRoot, packageRoot, addEnvKeys = false}) {
  const roots = consumerRoots(projectRoot, packageRoot), features = [], errors = [], notes = [];
  const feature = (name, status, detail) => features.push({name, status, ...(detail ? {detail} : {})});
  const manifest = existsSync(join(projectRoot, 'package.json')) ? readJson(join(projectRoot, 'package.json')) : {};
  const lock = existsSync(join(projectRoot, 'package-lock.json')) ? readJson(join(projectRoot, 'package-lock.json')) : undefined;

  // Skills: every listed link resolves into this installation.
  const linksFile = consumerPath(roots, LINKS_FILE);
  if (!existsSync(linksFile)) feature('skills (Claude and Codex)', UNAVAILABLE, 'setup has not run in this project');
  else {
    const broken = readJson(linksFile).links.filter(rel => {
      const entry = discoveryEntry(join(projectRoot, rel)), skill = join(packageRoot, '.agents/skills', rel.split('/').pop());
      return entry.kind !== 'link' || !entry.live || !existsSync(join(skill, 'SKILL.md'));
    });
    feature('skills (Claude and Codex)', broken.length ? UNAVAILABLE : READY, broken.length ? `${broken.length} links missing or broken; run setup` : undefined);
  }

  // The committed archive: present, matching the lockfile, tracked so teammates and CI can install it.
  const spec = manifest.devDependencies?.['playwright-pom-harness'] ?? manifest.dependencies?.['playwright-pom-harness'];
  if (!spec?.startsWith('file:.harness/vendor/')) notes.push('The project does not install the harness from .harness/vendor; run setup from the release archive.');
  else {
    const archive = spec.slice('file:'.length), absolute = join(projectRoot, archive), entry = lock?.packages?.['node_modules/playwright-pom-harness'];
    if (!existsSync(absolute)) errors.push(`${archive} is missing; teammates and CI cannot install the harness.`);
    else if (entry?.integrity && entry.integrity !== integrity(absolute)) errors.push(`${archive} differs from the integrity recorded in package-lock.json.`);
    else if (git(projectRoot, 'rev-parse', '--is-inside-work-tree').status === 0) {
      if (git(projectRoot, 'check-ignore', '-q', archive).status === 0) errors.push(`${archive} is git-ignored; teammates and CI cannot install the harness. Add "!/${archive}" to .gitignore.`);
      else if (git(projectRoot, 'ls-files', '--error-unmatch', archive).status !== 0) notes.push(`${archive} is not committed yet; commit it with the other setup changes.`);
    }
  }

  // Browser exploration: the pinned native CLI and the browser setup downloaded on this machine.
  try {
    nativeCliInstallation(packageRoot);
    const status = existsSync(consumerPath(roots, '.harness/state/setup/browsers.json')) ? readJson(consumerPath(roots, '.harness/state/setup/browsers.json')).harness : undefined;
    feature('browser exploration', status === 'installed' ? READY : UNAVAILABLE, status === 'installed' ? undefined : `browser not downloaded on this machine (${status ?? 'not attempted'}); run setup`);
  } catch {feature('browser exploration', UNAVAILABLE, 'the pinned native CLI is not installed; run npm ci');}

  // Generation verification needs the exact Playwright Test the adapter was validated with.
  const playwright = [installedVersion(projectRoot, '@playwright/test'), installedVersion(projectRoot, 'playwright')];
  feature('generation verification', playwright.every(version => version === GENERATION_PLAYWRIGHT) ? READY : UNAVAILABLE,
    playwright.every(version => version === GENERATION_PLAYWRIGHT) ? undefined : `needs @playwright/test and playwright ${GENERATION_PLAYWRIGHT}; found ${playwright.map(version => version ?? 'none').join(' and ')}`);
  const allure = Object.entries(ALLURE).map(([name, version]) => [name, version, installedVersion(projectRoot, name)]);
  if (allure.every(([, , found]) => found === undefined)) feature('Allure reporting', OPTIONAL, 'Allure packages are not installed');
  else {
    const wrong = allure.filter(([, version, found]) => found !== version);
    feature('Allure reporting', wrong.length ? UNAVAILABLE : READY, wrong.length ? wrong.map(([name, version, found]) => `${name} ${found ?? 'missing'} (needs ${version})`).join(', ') : undefined);
  }

  // Targets and credentials: configuration validated, secret names looked up, values never shown.
  const environment = consumerEnvironment(roots), missing = new Set(), malformed = [];
  const present = name => typeof environment[name] === 'string' && environment[name] !== '';
  const projectFile = consumerPath(roots, '.harness/project.json'), targetsFile = consumerPath(roots, '.harness/targets.json');
  if (!existsSync(projectFile)) feature('API and database targets', WAITING, 'no environment configured yet');
  else {
    try {
      const {project, targets} = validateConfiguration(readJson(projectFile), existsSync(targetsFile) ? readJson(targetsFile) : {api: {}, databases: {}});
      const selected = project.environments[project.defaultEnvironment];
      for (const id of selected.apiTargets) {const ref = targets.api[id].credentialRef; if (ref && !present(ref.slice(4))) missing.add(ref.slice(4));}
      for (const id of selected.databaseTargets) {
        const name = targets.databases[id].connectionRef.slice(4);
        if (!present(name)) missing.add(name);
        else {try {const value = JSON.parse(environment[name]); if (typeof value?.user !== 'string' || typeof value?.password !== 'string') malformed.push(name);} catch {malformed.push(name);}}
      }
      if (!selected.apiTargets.length && !selected.databaseTargets.length && !(selected.browserTargets ?? []).length) feature('API and database targets', WAITING, `environment ${project.defaultEnvironment} has no targets yet`);
      else if (missing.size || malformed.length) feature('API and database targets', WAITING, [missing.size && `missing secrets: ${[...missing].join(', ')}`, malformed.length && `not {"user","password"} JSON: ${malformed.join(', ')}`].filter(Boolean).join('; '));
      else feature('API and database targets', READY);
    } catch (error) {errors.push(`.harness configuration is invalid: ${error.message}`);}
  }
  if (!existsSync(consumerPath(roots, '.harness/integrations.json'))) feature('Azure DevOps', OPTIONAL);
  else {
    try {
      const {configuration} = loadAdoConfiguration(roots);
      if (present(configuration.credentialRef)) feature('Azure DevOps', READY);
      else {missing.add(configuration.credentialRef); feature('Azure DevOps', WAITING, `missing secret: ${configuration.credentialRef}`);}
    } catch (error) {errors.push(`.harness/integrations.json is invalid: ${error.message}`);}
  }

  // CI: a pipeline that runs Playwright tests also needs to install a browser.
  const pipelines = ['azure-pipelines.yml', ...(existsSync(join(projectRoot, '.github/workflows')) ? readdirSync(join(projectRoot, '.github/workflows')).filter(name => /\.ya?ml$/.test(name)).map(name => `.github/workflows/${name}`) : [])]
    .filter(file => existsSync(join(projectRoot, file)));
  const unprovisioned = pipelines.filter(file => {const text = readFileSync(join(projectRoot, file), 'utf8'); return /playwright\s+test/.test(text) && !/playwright\s+install/.test(text);});
  if (!pipelines.length) feature('CI pipeline', OPTIONAL);
  else feature('CI pipeline', unprovisioned.length ? UNAVAILABLE : READY, unprovisioned.length ? `${unprovisioned.join(', ')} runs Playwright tests without installing a browser` : undefined);

  // Dependency versions: the harness's cleared runtime graph against what npm installed here.
  // A project may hold its own version of the same package beside the harness's (for example
  // Playwright); only a cleared version missing from every installed copy counts as drift.
  if (lock) {
    const cleared = readJson(join(packageRoot, 'npm-shrinkwrap.json')).packages, installed = new Map();
    for (const [path, item] of Object.entries(lock.packages ?? {})) if (path) {const name = path.split('node_modules/').at(-1); installed.set(name, (installed.get(name) ?? new Set()).add(item.version));}
    const drift = Object.entries(cleared).filter(([path]) => path).map(([path, item]) => [path.split('node_modules/').at(-1), item.version])
      .filter(([name, version]) => installed.has(name) && !installed.get(name).has(version) && !TYPES_ONLY(name));
    if (drift.length) notes.push(`Dependency versions differ from the harness's cleared graph: ${drift.map(([name, version]) => `${name} ${[...installed.get(name)].join('/')} (cleared ${version})`).join(', ')}.`);
  }

  let envKeysAdded = [];
  if (addEnvKeys && missing.size) {
    envKeysAdded = [...missing].filter(name => !(name in environment)).sort();
    if (envKeysAdded.length) {
      const file = consumerPath(roots, '.env'), existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
      appendFileSync(file, `${existing && !existing.endsWith('\n') ? '\n' : ''}${envKeysAdded.map(name => `${name}=`).join('\n')}\n`);
    }
  }
  return {features, errors, notes, envKeysAdded};
}
