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
import {createTrackerClient, selectTracker, selectedTestManagement} from './selection.mjs';
import {jiraCasesToSource} from './jira-source.mjs';
import {JiraError} from './jira-client.mjs';
import {PluginError} from './plugin-client.mjs';
import {jiraStoryRevision} from './jira-requirements.mjs';
import {prepareLegacyRows, automationEligible} from './publication.mjs';
import {deliverNativeResults} from './native-publication.mjs';
import {nativeActions} from './native-actions.mjs';
import {createJiraWorkItems} from './jira-workitems.mjs';
import {validateLocalSource} from '../local-source.mjs';
import {writeJson} from '../execute/storage.mjs';
import {withTransition} from '../execute/lock.mjs';
import {fingerprint, keys} from '../execution-core/data.mjs';

const sharedCommands = {'fetch-suite': 'fetch-ado-suite', 'fetch-story': 'fetch-ado-story', 'publish-results': 'publish-ado-results',
  'tag-workitem': 'tag-ado-workitem', 'relink-story': 'relink-ado-story', 'edit-cases': 'edit-ado-cases'};

const options = {
  'fetch-ado-suite': {values: ['plan', 'suite', 'list-suites', 'org', 'org-url', 'project', 'env', 'out', 'source-out'], flags: ['list-plans', 'force', 'dry-run', 'json', 'revisions']},
  'fetch-ado-story': {values: ['story', 'links', 'org', 'org-url', 'project', 'env', 'out', 'source-out'], flags: ['force', 'dry-run', 'json', 'revisions']},
  'publish-ado-results': {values: ['plan', 'suite', 'value', 'point-map'], flags: ['mark-automated', 'all', 'dry-run', 'execute']},
  'tag-ado-workitem': {values: ['id', 'ids', 'tag'], flags: ['dry-run', 'execute']},
  'relink-ado-story': {values: ['id', 'ids', 'story'], flags: ['dry-run', 'execute']},
  'edit-ado-cases': {values: ['input', 'approval'], flags: ['dry-run', 'execute']},
  'ado-pr': {values: ['title', 'description', 'description-file', 'source', 'target', 'repository'], flags: ['draft', 'dry-run', 'execute', 'json']}
};
for (const [command, legacy] of Object.entries(sharedCommands)) options[command] = {values: [...options[legacy].values, 'provider', ...(legacy === 'publish-ado-results' ? ['group', 'statuses', 'step-statuses', 'manifest', 'approval', 'test-map', 'source', 'verification'] : []), ...(legacy === 'relink-ado-story' ? ['link-type', 'approval'] : legacy === 'tag-ado-workitem' ? ['approval'] : [])], flags: options[legacy].flags};
function argumentsFor(command, args) {
  const supported = options[command], output = {};
  requireValue(supported, 'Unknown integration command.');
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
function writeFetched(roots, opt, config, {name, scope, title, same, convert, extra = {}, render = renderSpec}) {
  const folder = join(opt.out ?? 'execution-tests', name), path = join(folder, '_suite.json');
  const previous = readConsumerJson(roots, path, true);
  if (previous) same(previous);
  const sourceFingerprint = hash(scope), feature = pascalCase(title);
  const legacy = readConsumerJson(roots, 'config/project.json', true) ?? {}, environment = opt.env ?? legacy.defaultEnvironment;
  if (environment !== undefined) requireValue(/^[A-Za-z0-9_-]+$/.test(environment), 'Invalid environment identifier.');
  const target = environment ? (readConsumerJson(roots, `environments/${environment}.json`, true)?.portalUrl ?? '') : '';
  const manifest = {...scope, ...extra, ...(config.organizationUrl ? {org: config.organizationUrl, orgUrl: config.organizationUrl} : {}), sourceFingerprint, environment: environment ?? null, target, fetchedAt: new Date().toISOString(),
    suggestedFeature: feature, suggestedSpecFile: `tests/${feature}Tests.spec.ts`, suggestedDataFile: `data/${feature}Data.json`, cases: []};
  for (const key of ['explore', 'resolvedSpecFiles', 'pr', 'markedAutomated']) if (previous?.[key] !== undefined) manifest[key] = previous[key];
  const files = [];
  for (const tc of scope.cases) {
    const old = previous?.cases?.find(item => item.id === tc.id), specFile = old?.specFile ?? `tc-${tc.id}-${slugify(tc.title)}.md`;
    requireValue(typeof specFile === 'string' && !/[\\/]/.test(specFile) && specFile.endsWith('.md'), 'Invalid legacy spec filename.');
    const file = consumerPath(roots, join(folder, specFile)), preserved = !opt.force && existsSync(file) && /^##\s+Refinement log/m.test(readFileSync(file, 'utf8'));
    manifest.cases.push({...tc, specFile, stepCount: tc.steps.length, preservedRefinement: preserved});
    if (!preserved) files.push({path: join(folder, specFile), text: render({tc, ...scope, target, org: config.organizationUrl, project: config.project})});
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

function jiraFolder(scope) {return `jira-${scope.selection.kind}-${scope.selection.id}-${hash({siteUrl: scope.siteUrl, project: scope.project, testManagement: scope.testManagement}).slice(0, 12)}`;}
export function jiraFetchScope(manifest) {
  return {provider: 'jira', siteUrl: manifest.siteUrl, project: manifest.project, projectId: manifest.projectId, testManagement: manifest.testManagement, selection: manifest.selection,
    ...(manifest.story ? {story: manifest.story} : {}), cases: manifest.cases.map(({specFile, stepCount, preservedRefinement, ...item}) => item)};
}
function sameJiraDestination(manifest, scope) {
  requireValue(manifest.provider === 'jira' && manifest.siteUrl === scope.siteUrl && manifest.project === scope.project && manifest.testManagement === scope.testManagement && hash(manifest.selection) === hash(scope.selection), 'Jira manifest differs from the selected site, project, plugin or source scope.');
}
async function fetchJira(client, management, command, roots, opt) {
  requireValue(management.capabilities.remoteCases, 'Jira without a test-management plugin uses local case sources.');
  requireValue(!opt['list-plans'] && !opt['list-suites'] && !opt.links && !opt.plan, 'Select an explicit native Jira story or suite; ADO plan/link discovery options do not apply.');
  const kind = command === 'fetch-ado-story' ? 'story' : 'suite', id = kind === 'story' ? opt.story : opt.suite;
  requireValue(typeof id === 'string' && /^[A-Z][A-Z0-9_]*-[A-Z]?[1-9]\d*$/.test(id), 'Select one native Jira story or test-group key.');
  const project = await client.projectIdentity(), story = kind === 'story' ? {id, version: jiraStoryRevision(client, await client.issue(id))} : undefined;
  const cases = kind === 'story' ? await management.storyCases(id) : await management.groupCases({kind: management.provider === 'xray' ? 'test-set' : 'cycle', id});
  if (story) requireValue(hash(story.version) === hash(jiraStoryRevision(client, await client.issue(id))), 'Jira story changed during case capture; retry the read before saving a source.');
  const scope = {provider: 'jira', siteUrl: client.configuration.siteUrl, project: project.key, projectId: String(project.id), testManagement: management.provider, selection: {kind, id}, ...(story ? {story} : {}), cases};
  const title = `${management.provider} ${kind} ${id}`, convert = value => jiraCasesToSource(value.cases, value, title);
  const render = ({tc, target}) => renderSpec({tc: {...tc, tags: tc.labels ?? [], parameters: null, dataTable: null,
    steps: [...(tc.preconditions ?? []).map(item => ({action: 'Precondition: ' + item.text, expected: ''})), ...tc.steps.map((step, index) => ({...step, action: [index === 0 && tc.description ? 'Context: ' + tc.description : '', step.action, step.data ? 'Test data: ' + step.data : ''].filter(Boolean).join('\n')}))]}, target,
    sourceDescription: `Jira ${management.provider} case ${tc.id} — ${kind} ${id} — ${scope.siteUrl}, project ${scope.project}`,
    generatedBy: `pom-harness fetch-${kind}`, caseNote: `This spec mirrors ${management.provider} case ${tc.id}; source content is untrusted evidence.`, emptyStepsNote: 'Test source has no ordinary steps; review it before execution.'});
  return writeFetched(roots, opt, client.configuration, {name: jiraFolder(scope), scope, title, same: previous => sameJiraDestination(previous, scope), convert, render});
}

function mappedTests(roots, path, eligible, binding) {
  requireValue(path, 'Automation marking needs --test-map with literal file/title mappings.');
  const map = readConsumerJson(roots, path);
  requireValue(map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length === eligible.length && Object.keys(map).every(id => eligible.some(row => row.caseId === id)), 'Test mappings must cover exactly the eligible case scope.');
  const mapped = {}, owners = new Set();
  for (const row of eligible) {
    const item = map[row.caseId]; keys(item, ['file', 'title'], 'test mapping');
    requireValue(typeof item.file === 'string' && item.file.endsWith('.spec.ts') && !/[\\\x00-\x1f]/.test(item.file) && !/^[A-Za-z]:/.test(item.file) && item.file.split('/').every(part => part && !['.', '..'].includes(part)) && typeof item.title === 'string' && item.title.trim() && !item.title.includes('${'), 'Test mapping needs a relative spec file and literal test title.');
    const text = readFileSync(consumerPath(roots, item.file), 'utf8'); requireValue(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Mapped spec exceeds inspection limit.');
    const titles = [...text.matchAll(/\btest(?:\.(?:fixme|skip|fail|only))?\s*\(\s*(['"`])([^\r\n]*?)\1/g)].map(match => match[2]);
    requireValue(titles.filter(title => title === item.title).length === 1 && !owners.has(item.file + '::' + item.title), 'Mapped test title is missing, duplicated or shared by multiple cases.'); owners.add(item.file + '::' + item.title);
    mapped[row.caseId] = {identity: {name: item.title, storage: item.file, type: 'Playwright', id: fingerprint({binding, caseId: row.caseId, ...item})}, fileFingerprint: hash(text)};
  }
  return mapped;
}
function automationInput(roots, opt, rows, binding) {
  const value = opt.value ?? 'Automated', eligible = automationEligible(rows, value);
  requireValue(eligible.length > 0, 'No case meets the existing verified PASS or application-defect FAIL automation gate.');
  return {value, eligible, tests: value === 'Automated' ? mappedTests(roots, opt['test-map'], eligible, binding) : {}};
}
async function localAutomation(roots, opt, dependencies) {
  requireValue(opt['mark-automated'] && opt.verification && !opt.manifest && !opt.suite && !opt.group && !opt.plan && !opt.statuses && !opt['point-map'] && !opt.all, 'Local automation needs --source, --verification and --mark-automated; native publication options do not apply.');
  const source = validateLocalSource(readConsumerJson(roots, opt.source)), sourceFingerprint = hash(source), state = readConsumerJson(roots, opt.verification), binding = {provider: 'local', id: source.id};
  requireValue(state.sourceFingerprint === sourceFingerprint, 'Local verification source fingerprint is missing or stale.');
  const selected = automationInput(roots, opt, prepareLegacyRows({cases: source.scenarios}, state), binding);
  const metadata = `.harness/state/integrations/local-automation-${hash(binding)}.json`;
  const desired = Object.fromEntries(selected.eligible.map(row => [row.caseId, {automated: selected.value === 'Automated', identity: selected.tests[row.caseId]?.identity ?? null}]));
  async function update() {
    const previous = readConsumerJson(roots, metadata, true) ?? {version: 1, binding, sourceFingerprint, cases: {}, history: []};
    requireValue(previous.version === 1 && hash(previous.binding) === hash(binding) && Array.isArray(previous.history), 'Local automation metadata is invalid.');
    const input = {binding, sourceFingerprint, verificationFingerprint: hash(state), value: selected.value, tests: selected.tests, desired};
    const last = previous.history.at(-1);
    if (opt.execute && last?.approval === opt.approval && last.inputFingerprint === hash(input) && Object.entries(desired).every(([id, item]) => hash(previous.cases[id]) === hash(item))) return {mode: 'resumed', metadata, fingerprint: last.approval};
    const plan = {...input, previousFingerprint: hash(previous)}, approved = hash(plan), preview = {mode: 'dry-run', fingerprint: approved, metadata, ...plan};
    if (!opt.execute) return preview;
    requireValue(opt.approval === approved, 'Execute needs --approval matching the exact reviewed preview fingerprint.');
    const next = {...previous, sourceFingerprint, cases: {...previous.cases, ...desired}, history: [...previous.history, {at: new Date().toISOString(), approval: approved, inputFingerprint: hash(input), sourceFingerprint, value: selected.value, cases: desired}]};
    writeJson(consumerPath(roots, metadata), next, {maximum: 16 * 1024 * 1024, maxNodes: 200000});
    return {...preview, mode: 'execute'};
  }
  return opt.execute ? withTransition(roots, update, {...dependencies.lockOptions, key: `automation-${hash(binding).slice(0, 32)}`}) : update();
}
async function nativeCompatibility(client, management, command, roots, opt, dependencies) {
  const binding = {provider: 'jira', siteUrl: client.configuration.siteUrl, project: client.configuration.project, testManagement: management.provider};
  const batch = input => nativeActions(roots, {binding, execute: Boolean(opt.execute), approval: opt.approval, lockOptions: dependencies.lockOptions, ...input});
  if (command === 'tag-ado-workitem' || command === 'relink-ado-story') {
    requireValue(!(opt.id && opt.ids) && (opt.id || opt.ids), 'Supply --id or --ids.');
    const ids = (opt.ids ?? opt.id).split(',').map(value => value.trim());
    requireValue(ids.length > 0 && ids.length <= 500 && new Set(ids).size === ids.length, 'Select unique bounded Jira issues.');
    const adapter = createJiraWorkItems(client), kind = command === 'tag-ado-workitem' ? 'tags' : 'relations';
    const input = {ids, ...(kind === 'tags' ? {tag: opt.tag} : {storyId: opt.story, ...(opt['link-type'] ? {linkTypeId: opt['link-type']} : {})})};
    requireValue(kind !== 'tags' || opt.tag, 'Supply --tag.'); requireValue(kind !== 'relations' || opt.story, 'Supply --story.');
    return batch({kind, input, prepare: async () => {const plans = []; for (const id of ids) plans.push(await adapter.prepare({id, ...input})); return plans;},
      delivery: approved => client.delivery(kind, true, approved), write: adapter.write, verify: adapter.verify, completion: adapter.completion});
  }
  requireValue(management.capabilities.remoteCases, 'Jira without a plugin keeps cases and automation status locally; select --source for local automation.');
  if (command === 'edit-ado-cases') {
    requireValue(opt.input, 'Supply --input with the reviewed case-edit proposal.'); const input = readConsumerJson(roots, opt.input);
    keys(input, ['version', 'cases'], 'case-edit proposal');
    requireValue(input.version === 1 && Array.isArray(input.cases) && input.cases.length > 0 && input.cases.length <= 100 && new Set(input.cases.map(item => item.id)).size === input.cases.length, 'Case edits need version 1 and 1–100 unique cases.');
    return batch({kind: 'case-edits', input, prepare: async () => {
      const plans = [];
      for (const row of input.cases) {
        keys(row, ['id', 'revision', 'title', 'steps', 'removeStepIds'], 'case edit');
        requireValue(row.title !== undefined || row.steps !== undefined, 'Select a title or complete ordered steps for each case edit.');
        const before = await management.readCase(row.id); requireValue(typeof row.revision === 'string' && row.revision === before.revision, 'Stale native case revision; refetch before editing.');
        requireValue(row.removeStepIds === undefined || row.steps !== undefined && Array.isArray(row.removeStepIds), 'Step removals need a complete ordered steps list.');
        if (row.removeStepIds) requireValue(row.removeStepIds.every(id => before.steps.some(step => step.id === id)) && new Set(row.removeStepIds).size === row.removeStepIds.length, 'Removed native step IDs are missing or duplicated.');
        const steps = row.steps ?? before.steps;
        if (row.steps) {
          requireValue(Array.isArray(steps), 'Native case steps must be ordered.');
          for (const step of steps) keys(step, ['id', 'action', 'expected', 'data'], 'native case step');
          if (steps.some(step => step.id !== undefined)) {
            requireValue(steps.every(step => step.id === undefined || before.steps.some(item => item.id === step.id)) && new Set(steps.filter(step => step.id !== undefined).map(step => step.id)).size === steps.filter(step => step.id !== undefined).length, 'Native step IDs must be known and unique.');
            const removed = before.steps.filter(step => !steps.some(item => item.id === step.id)).map(step => step.id);
            requireValue(hash([...removed].sort()) === hash([...(row.removeStepIds ?? [])].sort()), 'Explicitly review removed native step IDs.');
          } else requireValue(!row.removeStepIds?.length, 'Step removals require native IDs on retained steps.');
        }
        plans.push(await management.prepareCase({before, title: row.title ?? before.title, steps, marker: `pom-harness-edit-${hash({binding, input, id: row.id}).slice(0, 32)}`}));
      }
      return plans;
    }, delivery: approved => management.delivery('case-edits', true, approved), write: (plan, delivery) => management.writeCase(plan, delivery), verify: plan => management.verifyCase(plan, plan.id), completion: plan => management.caseCompletion(plan, plan.id)});
  }
  requireValue(command === 'publish-ado-results' && opt.manifest && !opt.all && !opt.plan && !opt['point-map'] && !opt.verification, 'Native publication needs --manifest; ADO plan/point selectors or verification bypasses do not apply.');
  const manifest = readConsumerJson(roots, opt.manifest), scope = jiraFetchScope(manifest);
  requireValue(manifest.provider === 'jira' && manifest.siteUrl === binding.siteUrl && manifest.project === binding.project && manifest.testManagement === binding.testManagement && (!opt.suite || manifest.selection.kind === 'suite' && manifest.selection.id === opt.suite), 'Manifest differs from selected Jira site/project/plugin/scope.');
  requireValue(manifest.sourceFingerprint === hash(scope), 'Native manifest source changed after capture.');
  const state = readConsumerJson(roots, join(dirname(opt.manifest), '_verify-state.json'));
  requireValue(state.sourceFingerprint === manifest.sourceFingerprint, 'Verification source fingerprint is missing or stale.');
  const rows = prepareLegacyRows(manifest, state);
  async function fresh() {
    for (const before of scope.cases) {const now = await management.readCase(before.id); requireValue(now.revision === before.revision && now.fingerprint === before.fingerprint, 'Native source case changed; refetch and verify the current source.');}
    if (scope.story) requireValue(hash(jiraStoryRevision(client, await client.issue(scope.story.id))) === hash(scope.story.version), 'Selected Jira story changed; refetch and verify the source.');
  }
  const input = {manifestFingerprint: manifest.sourceFingerprint, verificationFingerprint: hash(state)};
  if (opt['mark-automated']) {
    requireValue(!opt.group && !opt.statuses && !opt['step-statuses'], 'Automation marking does not publish native results.');
    const selected = automationInput(roots, opt, rows, binding);
    return batch({kind: 'automation', input: {...input, ...selected}, prepare: async () => {
      await fresh(); const plans = []; for (const row of selected.eligible) plans.push(await management.prepareAutomation({before: scope.cases.find(item => item.id === row.caseId), automated: selected.value === 'Automated', ...(selected.tests[row.caseId] ? {identity: selected.tests[row.caseId].identity} : {})})); return plans;
    }, delivery: approved => management.delivery('automation', true, approved), write: management.writeAutomation, verify: management.verifyAutomation, completion: management.automationCompletion});
  }
  requireValue(!opt.value && !opt['test-map'] && opt.group && opt.statuses, 'Result publication needs an explicit existing --group and --statuses file.');
  const statuses = readConsumerJson(roots, opt.statuses), stepStatuses = opt['step-statuses'] ? readConsumerJson(roots, opt['step-statuses']) : undefined;
  const resultInput = {...input, groupId: opt.group, statuses, ...(stepStatuses ? {stepStatuses} : {})};
  return batch({kind: 'outcomes', input: resultInput, prepare: async () => {await fresh(); return [await management.prepareResults({...resultInput, automated: true, marker: `pom-harness-results-${hash({binding, resultInput}).slice(0, 32)}`,
    results: rows.map(row => ({caseId: row.caseId, outcome: {SKIPPED: 'NOT_RUN', NEEDS_REVIEW: 'REVIEW_REQUIRED'}[row.status] ?? row.status, comment: `Harness status=${row.status}; stability=${row.stability}; classification=${row.classification}`}))})];},
    results: input => deliverNativeResults(management, {...input, roots})});
}

/** Existing command names; consumer IO stays here, remote responsibilities stay in adapters. */
export async function runCompatibility(command, argv, dependencies = {}) {
  if (command === 'fetch-ado-suite' && argv.length === 1 && argv[0] === '--self-test') return selfTest();
  const {roots, args} = projectArgument(argv), opt = argumentsFor(command, args);
  if (command === 'publish-results' && opt.source) return localAutomation(roots, opt, dependencies);
  const provider = sharedCommands[command] ? selectTracker(roots, opt.provider) : 'ado'; command = sharedCommands[command] ?? command;
  requireValue(provider !== 'jira' || !opt.org && !opt['org-url'] && !opt.project, 'Select the configured Jira destination; ADO destination overrides do not apply.');
  const configured = provider === 'ado' ? loadAdoConfiguration(roots, {org: opt.org, organizationUrl: opt['org-url'], project: opt.project}, dependencies.environment) : undefined;
  const client = provider === 'ado' ? createAdoClient({...configured, roots, ...(dependencies.fetchImpl ? {fetchImpl: dependencies.fetchImpl} : {})}) : createTrackerClient(roots, {...dependencies, provider}), config = client.configuration;
  const nativeManagement = provider === 'jira' ? selectedTestManagement(roots, client, dependencies) : undefined;
  if (provider === 'jira' && ['fetch-ado-suite', 'fetch-ado-story'].includes(command)) return fetchJira(client, nativeManagement, command, roots, opt);
  if (provider === 'jira') return nativeCompatibility(client, nativeManagement, command, roots, opt, dependencies);
  if (command === 'fetch-ado-suite') {
    const source = createAdoTestSource(client);
    if (opt['list-plans']) return source.listPlans();
    if (opt['list-suites']) return source.listSuites(opt['list-suites']);
    const suite = await source.fetchSuite(opt.plan ?? config.planId, opt.suite, {includeRevisions: Boolean(opt.revisions)});
    return writeFetched(roots, opt, config, {name: `ado-suite-${suite.suiteId}`, scope: suite, title: suite.suiteName, same: previous => sameDestination(previous, config, suite.planId, suite.suiteId), convert: adoSuiteToSource});
  }
  if (command === 'fetch-ado-story') {
    requireValue(opt.story, 'Supply --story.');
    // Exclusions are reported and recorded but never fingerprinted: an unrelated Task link must not invalidate verification.
    const {excluded, ...story} = await createAdoTestSource(client).fetchStory(opt.story, opt.links?.split(',').map(value => value.trim()), {includeRevisions: Boolean(opt.revisions)});
    const same = previous => requireValue((previous.orgUrl ?? previous.organizationUrl) === config.organizationUrl && previous.project === config.project && previous.storyId === story.storyId
      && previous.planId === undefined && previous.suiteId === undefined, 'Story manifest does not match the configured ADO destination and scope.');
    return {...writeFetched(roots, opt, config, {name: `ado-story-${story.storyId}`, scope: story, title: story.storyTitle, same, convert: adoStoryToSource, extra: {excluded}}), excluded};
  }
  const management = createAdoTestManagement(client);
  if (command === 'edit-ado-cases') {
    requireValue(opt.input, 'Supply --input with a consumer case-edit proposal.');
    return management.editCases({input: readConsumerJson(roots, opt.input), execute: opt.execute ?? false, approval: opt.approval});
  }
  if (command === 'tag-ado-workitem' || command === 'relink-ado-story') {
    requireValue(!(opt.id && opt.ids) && (opt.id || opt.ids), 'Supply --id or --ids.'); const ids = (opt.ids ?? opt.id).split(',').map(value => adoId(value.trim()));
    return command === 'tag-ado-workitem' ? management.tag({ids, tag: opt.tag, execute: opt.execute ?? false}) : management.relink({ids, storyId: opt.story, execute: opt.execute ?? false});
  }
  if (command === 'publish-ado-results') {
    const suiteId = adoId(opt.suite), folder = `execution-tests/ado-suite-${suiteId}`, manifest = readConsumerJson(roots, `${folder}/_suite.json`);
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
  return error instanceof AdoError || error instanceof JiraError || error instanceof PluginError ? error.message : error.code ? 'Local input or IO failed; check consumer paths/configuration.' : error.message;
}
export function compatibilityMain(command, argv = process.argv.slice(2)) {
  runCompatibility(command, argv).then(result => { if (result !== undefined) console.log(JSON.stringify(result, null, 2)); if (['incomplete', 'reconciliation-required'].includes(result?.mode)) process.exitCode = 1; }).catch(error => {
    // Never expose transport stacks, response bodies, credential values or filesystem error detail.
    console.error(`[${command}] ${compatibilityDiagnostic(error)}`); process.exitCode = 1;
  });
}
