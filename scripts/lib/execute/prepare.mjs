import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {consumerPath} from '../consumer-paths.mjs';
import {loadEnvironment} from '../project-config.mjs';
import {secretFindings} from '../package-validation.mjs';
import {adoId, loadAdoConfiguration} from '../integrations/config.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {createAdoTestSource} from '../integrations/ado-source.mjs';
import {manifestSource, writeFetched} from '../integrations/compatibility.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {prepareSource} from './source.mjs';
import {draftRefinement, scopedReadiness} from './refinement.mjs';
import {createExecution, EXECUTION_DOCUMENT, readExecution, readFrozen, readOptional} from './storage.mjs';
import {withTransition} from './lock.mjs';

function matches(source, scope, config) {
  return fingerprint(source.scope) === fingerprint(scope) && source.organizationUrl === config.organizationUrl && source.project === config.project;
}

function findPrevious(roots, scope, config, executionId) {
  if (executionId) {
    try {
      const saved = readExecution(roots, executionId);
      if (matches(saved.source, scope, config)) return saved;
    } catch { /* A missing or invalid capture cannot be reused. */ }
  }
  const runs = consumerPath(roots, '.harness/runs');
  let entries;
  try {entries = readdirSync(runs, {withFileTypes: true});}
  catch (error) {if (error.code === 'ENOENT') return; throw error;}
  let latest;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^execute-[a-f0-9-]{36}$/.test(entry.name)) continue;
    try {
      const record = readOptional(consumerPath(roots, join(runs, entry.name, 'execution.json')));
      if (!record || (latest && record.createdAt <= latest.execution.createdAt)) continue;
      const saved = readExecution(roots, entry.name);
      if (matches(saved.source, scope, config)) latest = saved;
    } catch { /* An incomplete run is not a preparation baseline. */ }
  }
  return latest;
}

function exportCases(source) {
  return source.cases.map(tc => {
    const rows = source.scenarios.filter(scenario => scenario.caseId === tc.id), first = rows[0];
    const names = [...new Set(rows.flatMap(row => [...Object.keys(row.bindings), ...row.needsBinding]))];
    return {id: tc.id, rev: tc.rev, title: first.title, tags: [], contentSha256: tc.contentSha256,
      steps: first.steps.map(step => ({kind: 'step', action: step.actionTemplate, expected: step.expectedTemplates.join('\n'), ...(step.fromShared ? {fromShared: step.fromShared} : {})})),
      sharedRevisions: Object.fromEntries(tc.sharedIds.map(id => [id, source.sharedSteps[id]])),
      parameters: names.length ? `<parameters>${names.map(name => `<param name="${name}"/>`).join('')}</parameters>` : null,
      dataTable: names.length ? rows.map(row => row.bindings) : null};
  });
}

function reuseRefinement(roots, previous, environment, draft, source, reused) {
  if (!previous?.execution.freezeFingerprint || !reused.size) return [];
  try {
    const {freeze, refinement: saved} = readFrozen(roots, previous.execution.id);
    if (freeze.environmentFingerprint !== fingerprint(environment)) return [];
    const byId = new Map(saved.scenarios.map(scenario => [scenario.id, scenario]));
    const reusedIds = new Set(source.scenarios.filter(scenario => reused.has(scenario.caseId) && byId.has(scenario.id)).map(scenario => scenario.id));
    if (!reusedIds.size) return [];
    draft.scenarios = draft.scenarios.map(scenario => reusedIds.has(scenario.id) ? byId.get(scenario.id) : scenario);
    draft.references = saved.references ?? {};
    if (saved.limits) draft.limits = saved.limits;
    return [...reusedIds];
  } catch {return [];}
}

export async function prepareExecution(roots, kind, selected, options, dependencies) {
  const configured = loadAdoConfiguration(roots, {}, dependencies.environment);
  const client = createAdoClient({...configured, roots, fetchImpl: dependencies.fetchImpl}), config = client.configuration;
  const environment = loadEnvironment(roots, options.environment), adapter = createAdoTestSource(client);
  const scope = kind === 'suite' ? {kind, planId: adoId(options.plan ?? config.planId), suiteId: selected} : {kind, storyId: selected};
  const name = `ado-${kind}-${selected}`, manifestPath = consumerPath(roots, `execution-tests/${name}/_suite.json`);
  const manifest = readOptional(manifestPath, EXECUTION_DOCUMENT.maximum);
  if (manifest) requireThat((manifest.orgUrl ?? manifest.organizationUrl) === config.organizationUrl && manifest.project === config.project
    && (kind === 'story' ? manifest.storyId === selected : manifest.planId === scope.planId && manifest.suiteId === selected), 'Case manifest does not match the configured ADO destination and scope.');
  const previous = findPrevious(roots, scope, config, manifest?.executionId);
  const exported = manifest?.organizationUrl === config.organizationUrl && (kind === 'suite' || fingerprint(manifest.links) === fingerprint(['tested-by'])) ? manifestSource(manifest) : undefined;
  const previousCases = previous ? exportCases(previous.source) : exported && !manifest.executionId ? exported.cases : [];
  const usable = previousCases.filter(tc => Number.isSafeInteger(tc.rev) && tc.rev > 0 && tc.sharedRevisions && Object.entries(tc.sharedRevisions).every(([id, rev]) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(rev) && rev > 0));
  const fetchOptions = {tolerant: true, previousCases: usable};
  const fetched = kind === 'suite' ? await adapter.fetchSuite(scope.planId, selected, fetchOptions) : await adapter.fetchStory(selected, ['tested-by'], fetchOptions);
  const captured = prepareSource(fetched, scope, previous?.source), refinement = draftRefinement(captured, environment);
  const reused = new Set(fetched.reusedCaseIds.filter(id => captured.cases.some(tc => tc.id === id)));
  const reusedRefinement = reuseRefinement(roots, previous, environment, refinement, captured, reused);
  const oldCases = new Map(previousCases.map(tc => [tc.id, tc]));
  const currentIds = new Set(fetched.caseIds), changes = {added: [], updated: [], removed: [], reused: reused.size};
  const screenedCases = exportCases(captured);
  for (const tc of screenedCases) {
    const old = oldCases.get(tc.id), row = {id: tc.id, title: tc.title, revision: tc.rev};
    if (!old) changes.added.push(row);
    else if (!reused.has(tc.id)) changes.updated.push({...row, previousRevision: old.rev ?? null});
  }
  for (const tc of previousCases) if (!currentIds.has(tc.id)) changes.removed.push({id: tc.id, title: tc.title, revision: tc.rev ?? null});

  const result = createExecution(roots, captured, refinement, {checkpoint: options.checkpoint, diagnostics: options.diagnostics, parentExecutionId: previous?.execution.id});
  await withTransition(roots, () => {
    const current = readOptional(manifestPath, EXECUTION_DOCUMENT.maximum);
    requireThat(current?.sourceFingerprint === manifest?.sourceFingerprint && current?.executionId === manifest?.executionId, 'Case selection was refreshed by another command. Retry preparation.');
    const metadata = kind === 'story' ? {storyId: selected, storyTitle: captured.title, links: fetched.links}
      : {planId: scope.planId, suiteId: selected, suiteName: captured.title};
    const target = environment.targets.browser?.[environment.browserTargets?.[0]]?.startUrl ?? '';
    const oldExport = new Map(exported?.cases.map(tc => [tc.id, tc])), reusedExport = new Set();
    const protectedCases = new Set(captured.scenarios.filter(row => row.needsBinding.length).map(row => row.caseId));
    const cases = screenedCases.map(tc => {
      const old = oldExport.get(tc.id);
      if (!reused.has(tc.id) || old?.rev !== tc.rev || fingerprint(old.sharedRevisions) !== fingerprint(tc.sharedRevisions)
        || protectedCases.has(tc.id) || secretFindings('execution.json', JSON.stringify(old)).length) return tc;
      reusedExport.add(tc.id);
      return old;
    });
    writeFetched(roots, {env: environment.name}, config, {name, title: captured.title, extra: {excluded: captured.excluded, executionId: result.executionId},
      scope: {...metadata, organizationUrl: config.organizationUrl, project: config.project, cases, ...(kind === 'story' ? {storyRev: fetched.storyRev} : {})},
      execution: {target, previous: current, reused: reusedExport}});
  }, {key: `prepare-${name}`, inventory: dependencies.inventory});
  return {...result, status: 'PREPARED', changes, reusedRefinement, refinement: join(result.directory, 'refinement.json'),
    ...(previous ? {parentExecutionId: previous.execution.id, previousRefinement: join(previous.directory, 'refinement.json')} : {}),
    readiness: scopedReadiness(roots, {environment, scenarios: refinement.scenarios})};
}

export function prepareFrozenRerun(roots, kind, selected, options) {
  const parentExecutionId = options['from-snapshot'], saved = readFrozen(roots, parentExecutionId), scope = saved.source.scope;
  requireThat(scope.kind === kind && (kind === 'story' ? scope.storyId === selected : scope.suiteId === selected && (!options.plan || scope.planId === adoId(options.plan))), 'Frozen execution does not match the requested story or suite.');
  requireThat(!options.environment || options.environment === saved.freeze.environment.name, 'Frozen reruns use the captured environment.');
  const result = createExecution(roots, saved.source, saved.refinement, {parentExecutionId, freeze: saved.freeze, guardRefs: saved.execution.guardRefs,
    checkpoint: options.checkpoint ?? saved.execution.checkpoint, diagnostics: options.diagnostics ?? saved.execution.diagnostics});
  return {...result, status: 'FROZEN', parentExecutionId, readiness: scopedReadiness(roots, saved.freeze)};
}
