import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectArgument, consumerPath} from '../consumer-paths.mjs';
import {loadAdoConfiguration, readConsumerJson, adoId, requireValue} from './config.mjs';
import {createAdoClient, AdoError} from './ado-client.mjs';
import {createAdoTestSource, adoSuiteToSource, adoStoryToSource} from './ado-source.mjs';
import {createAdoTestManagement, prepareLegacyPublication} from './ado-management.mjs';
import {createAdoSourceControl} from './ado-delivery.mjs';
import {slugify, pascalCase, renderSpec, selfTest} from './ado-steps.mjs';

const options = {
  'fetch-ado-suite': {values: ['plan', 'suite', 'list-suites', 'org', 'org-url', 'project', 'env', 'out', 'source-out'], flags: ['list-plans', 'force', 'dry-run', 'json']},
  'fetch-ado-story': {values: ['story', 'links', 'org', 'org-url', 'project', 'env', 'out', 'source-out'], flags: ['force', 'dry-run', 'json']},
  'publish-ado-results': {values: ['plan', 'suite', 'value', 'point-map'], flags: ['mark-automated', 'all', 'dry-run', 'execute']},
  'tag-ado-workitem': {values: ['id', 'ids', 'tag'], flags: ['dry-run', 'execute']},
  'relink-ado-story': {values: ['id', 'ids', 'story'], flags: ['dry-run', 'execute']},
  'ado-pr': {values: ['title', 'description', 'description-file', 'source', 'target', 'repository'], flags: ['draft', 'dry-run', 'execute', 'json']}
};
function argumentsFor(command, args) {
  const supported = options[command], output = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i].slice(2); requireValue(args[i].startsWith('--') && !Object.hasOwn(output, name), 'Unknown or duplicate command argument.');
    if (supported.flags.includes(name)) output[name] = true;
    else { requireValue(supported.values.includes(name) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown command option or missing value.'); output[name] = args[++i]; }
  }
  requireValue(!(output.execute && output['dry-run']), 'Choose preview or --execute, not both.'); return output;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sameDestination(manifest, configuration, planId, suiteId) {
  requireValue((manifest.orgUrl ?? manifest.organizationUrl) === configuration.organizationUrl && manifest.project === configuration.project && adoId(manifest.planId) === planId && adoId(manifest.suiteId) === suiteId, 'Suite manifest does not match the configured ADO destination and scope.');
}
function pointers(roots, manifest) {
  const found = {};
  for (const file of manifest.resolvedSpecFiles ?? (manifest.suggestedSpecFile ? [manifest.suggestedSpecFile] : [])) {
    const path = consumerPath(roots, file); if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8'); requireValue(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Generated test file exceeds inspection limit.');
    const titles = [...text.matchAll(/\btest(?:\.(?:fixme|skip|fail|only))?\s*\(\s*(['"`])([^\r\n]*?)\1/g)];
    for (const match of text.matchAll(/allure\.tms\s*\(\s*['"`](\d+)['"`]/g)) {
      const owner = titles.filter(title => title.index < match.index).at(-1), id = adoId(match[1]);
      requireValue(owner && !owner[2].includes('${') && !found[id], 'Generated test pointer is missing, dynamic or duplicated; supply literal one-case test mappings.');
      found[id] = {file: file.replaceAll('\\', '/'), title: owner[2]};
    }
  }
  return found;
}
/** One consumer write flow for every fetch scope; the scope object is exactly what the fingerprint covers. */
function writeFetched(roots, opt, config, {name, scope, title, same, convert, extra = {}}) {
  const folder = join(opt.out ?? 'test', name), path = join(folder, '_suite.json');
  const previous = readConsumerJson(roots, path, true);
  if (previous) same(previous);
  const sourceFingerprint = hash(scope), feature = pascalCase(title);
  const legacy = readConsumerJson(roots, 'config/project.json', true) ?? {}, environment = opt.env ?? legacy.defaultEnvironment;
  if (environment !== undefined) requireValue(/^[A-Za-z0-9_-]+$/.test(environment), 'Invalid environment identifier.');
  const target = environment ? (readConsumerJson(roots, `environments/${environment}.json`, true)?.portalUrl ?? '') : '';
  const manifest = {...scope, ...extra, org: config.organizationUrl, orgUrl: config.organizationUrl, sourceFingerprint, environment: environment ?? null, target, fetchedAt: new Date().toISOString(),
    suggestedFeature: feature, suggestedSpecFile: `tests/${feature}Tests.spec.ts`, suggestedDataFile: `data/${feature}Data.json`, cases: []};
  for (const key of ['explore', 'resolvedSpecFiles', 'pr', 'markedAutomated']) if (previous?.[key] !== undefined) manifest[key] = previous[key];
  const files = [];
  for (const tc of scope.cases) {
    const old = previous?.cases?.find(item => item.id === tc.id), specFile = old?.specFile ?? `tc-${tc.id}-${slugify(tc.title)}.md`;
    requireValue(typeof specFile === 'string' && !/[\\/]/.test(specFile) && specFile.endsWith('.md'), 'Invalid legacy spec filename.');
    const file = consumerPath(roots, join(folder, specFile)), preserved = !opt.force && existsSync(file) && /^##\s+Refinement log/m.test(readFileSync(file, 'utf8'));
    manifest.cases.push({...tc, specFile, stepCount: tc.steps.length, preservedRefinement: preserved});
    if (!preserved) files.push({path: join(folder, specFile), text: renderSpec({tc, ...scope, target, org: config.organizationUrl, project: config.project})});
  }
  // Conversion must succeed before any compatibility output is changed.
  if (opt['source-out']) files.push({path: opt['source-out'], text: JSON.stringify(convert(scope), null, 2) + '\n'});
  files.push({path, text: JSON.stringify(manifest, null, 2) + '\n'});
  const destinations = files.map(file => consumerPath(roots, file.path));
  requireValue(new Set(destinations.map(file => process.platform === 'win32' ? file.toLowerCase() : file)).size === files.length, 'Output paths collide.');
  if (!opt['dry-run']) for (const file of files) {
    mkdirSync(dirname(consumerPath(roots, file.path)), {recursive: true}); writeFileSync(consumerPath(roots, file.path), file.text);
  }
  return {mode: opt['dry-run'] ? 'dry-run' : 'fetched', cases: scope.cases.length, files: files.map(file => file.path.replaceAll('\\', '/')), sourceFingerprint};
}

/** Existing command names; consumer IO stays here, remote responsibilities stay in adapters. */
export async function runCompatibility(command, argv, dependencies = {}) {
  if (command === 'fetch-ado-suite' && argv.length === 1 && argv[0] === '--self-test') return selfTest();
  const {roots, args} = projectArgument(argv), opt = argumentsFor(command, args);
  const configured = loadAdoConfiguration(roots, {org: opt.org, organizationUrl: opt['org-url'], project: opt.project}, dependencies.environment);
  const client = createAdoClient({...configured, roots, ...(dependencies.fetchImpl ? {fetchImpl: dependencies.fetchImpl} : {})}), config = client.configuration;
  if (command === 'fetch-ado-suite') {
    const source = createAdoTestSource(client);
    if (opt['list-plans']) return source.listPlans();
    if (opt['list-suites']) return source.listSuites(opt['list-suites']);
    const suite = await source.fetchSuite(opt.plan ?? config.planId, opt.suite);
    return writeFetched(roots, opt, config, {name: `ado-suite-${suite.suiteId}`, scope: suite, title: suite.suiteName, same: previous => sameDestination(previous, config, suite.planId, suite.suiteId), convert: adoSuiteToSource});
  }
  if (command === 'fetch-ado-story') {
    requireValue(opt.story, 'Supply --story.');
    // Exclusions are reported and recorded but never fingerprinted: an unrelated Task link must not invalidate verification.
    const {excluded, ...story} = await createAdoTestSource(client).fetchStory(opt.story, opt.links?.split(',').map(value => value.trim()));
    const same = previous => requireValue((previous.orgUrl ?? previous.organizationUrl) === config.organizationUrl && previous.project === config.project && previous.storyId === story.storyId
      && previous.planId === undefined && previous.suiteId === undefined, 'Story manifest does not match the configured ADO destination and scope.');
    return {...writeFetched(roots, opt, config, {name: `ado-story-${story.storyId}`, scope: story, title: story.storyTitle, same, convert: adoStoryToSource, extra: {excluded}}), excluded};
  }
  const management = createAdoTestManagement(client);
  if (command === 'tag-ado-workitem' || command === 'relink-ado-story') {
    requireValue(!(opt.id && opt.ids) && (opt.id || opt.ids), 'Supply --id or --ids.'); const ids = (opt.ids ?? opt.id).split(',').map(value => adoId(value.trim()));
    return command === 'tag-ado-workitem' ? management.tag({ids, tag: opt.tag, execute: opt.execute ?? false}) : management.relink({ids, storyId: opt.story, execute: opt.execute ?? false});
  }
  if (command === 'publish-ado-results') {
    const suiteId = adoId(opt.suite), folder = `test/ado-suite-${suiteId}`, manifest = readConsumerJson(roots, `${folder}/_suite.json`);
    const planId = adoId(opt.plan ?? manifest.planId); sameDestination(manifest, config, planId, suiteId);
    const state = readConsumerJson(roots, `${folder}/_verify-state.json`);
    if (manifest.sourceFingerprint) requireValue(state.sourceFingerprint === manifest.sourceFingerprint, 'Verification source fingerprint is missing or stale; verify the current source.');
    const publication = prepareLegacyPublication(manifest, state);
    requireValue(!opt.all, '--all no longer bypasses verification; select and verify the intended manifest scope.');
    if (opt['mark-automated']) return management.markAutomation({publication, tests: pointers(roots, manifest), value: opt.value ?? 'Automated', execute: opt.execute ?? false});
    requireValue(!opt.value, '--value is only valid with --mark-automated.');
    return management.publish({publication, planId, suiteId, pointIds: opt['point-map'] ? readConsumerJson(roots, opt['point-map']) : {}, execute: opt.execute ?? false});
  }
  let source = opt.source;
  if (!source) { try { source = execFileSync('git', ['branch', '--show-current'], {cwd: roots.projectRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { throw new Error('Cannot resolve current branch; supply --source.'); } }
  requireValue(!(opt.description && opt['description-file']), 'Choose description text or a description file.');
  const description = opt['description-file'] ? readFileSync(consumerPath(roots, opt['description-file']), 'utf8') : opt.description;
  return createAdoSourceControl(client).createPullRequest({repository: opt.repository, source, target: opt.target, title: opt.title, description, draft: opt.draft ?? false, execute: opt.execute ?? false});
}

export function compatibilityDiagnostic(error) {
  return error instanceof AdoError ? error.message : error.code ? 'Local input or IO failed; check consumer paths/configuration.' : error.message;
}
export function compatibilityMain(command) {
  runCompatibility(command, process.argv.slice(2)).then(result => { if (result !== undefined) console.log(JSON.stringify(result, null, 2)); }).catch(error => {
    // Never expose transport stacks, response bodies, credential values or filesystem error detail.
    console.error(`[${command}] ${compatibilityDiagnostic(error)}`); process.exitCode = 1;
  });
}
