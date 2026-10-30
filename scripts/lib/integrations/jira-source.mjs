import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {validateLocalSource} from '../local-source.mjs';
import {prepareNeutralSource} from '../execute/source.mjs';
import {jiraStoryRevision} from './jira-requirements.mjs';

const identity = (scope, id) => fingerprint({siteUrl: scope.siteUrl, project: scope.project, provider: scope.testManagement, id}).slice(0, 24);
function stepsFor(item) {
  const setup = (item.preconditions ?? []).map(value => value.text).filter(Boolean);
  return [...(setup.length ? [{action: 'Preconditions:\n' + setup.join('\n'), expected: []}] : []),
    ...item.steps.map((step, index) => ({action: [index === 0 && item.description ? 'Context:\n' + item.description : '', step.action, step.data ? 'Test data:\n' + step.data : ''].filter(Boolean).join('\n\n'), expected: step.expected ? [step.expected] : []}))];
}
/** Native content becomes the existing local-source contract; provider identities remain site-qualified. */
export function jiraCasesToSource(cases, scope, title) {
  requireThat(Array.isArray(cases) && cases.length > 0 && cases.length <= 500 && new Set(cases.map(item => item.id)).size === cases.length, 'Select 1–500 distinct native Jira test cases.');
  for (const item of cases) requireThat(item.siteUrl === scope.siteUrl && item.project === scope.project && item.provider === scope.testManagement && typeof item.id === 'string' && typeof item.revision === 'string' && /^[a-f0-9]{64}$/.test(item.fingerprint), 'Native test identity or revision differs from the selected destination.');
  return validateLocalSource({version: 1, id: 'jira-' + identity(scope, scope.selection), title: title ?? `${scope.testManagement} ${scope.selection.kind} ${scope.selection.id}`,
    scenarios: cases.map(item => ({id: 'case-' + identity(scope, item.id), title: item.title, steps: stepsFor(item),
      externalReferences: item.externalReferences ?? [{system: scope.testManagement, id: `${scope.siteUrl}/browse/${item.id}`}]}))});
}
export async function captureJiraExecution(client, management, selection) {
  requireThat(management.capabilities.remoteCases, 'Jira without a test-management plugin uses local cases: prepare local <source.json>.');
  requireThat(selection && ['story', 'case', 'suite', 'plan', 'execution', 'folder'].includes(selection.kind) && typeof selection.id === 'string' && selection.id.length > 0 && selection.id.length <= 200, 'Select an explicit native Jira test scope.');
  const project = await client.projectIdentity();
  const story = selection.kind === 'story' ? {id: selection.id, version: jiraStoryRevision(client, await client.issue(selection.id))} : undefined;
  const groupKind = selection.kind === 'suite' ? management.provider === 'xray' ? 'test-set' : 'cycle' : selection.kind === 'execution' && management.provider === 'zephyr-scale' ? 'cycle' : selection.kind;
  const cases = selection.kind === 'story' ? await management.storyCases(selection.id) : selection.kind === 'case' ? [await management.readCase(selection.id)] : await management.groupCases({kind: groupKind, id: selection.id});
  const scope = {kind: 'jira', siteUrl: client.configuration.siteUrl, project: project.key, projectId: String(project.id), testManagement: management.provider, selection};
  const neutral = jiraCasesToSource(cases, scope), source = prepareNeutralSource(neutral, scope);
  source.cases = cases.map((item, index) => ({id: item.id, nativeId: item.nativeId, revision: item.revision, nativeFingerprint: item.fingerprint,
    contentSha256: source.cases[index].contentSha256, sharedIds: [], setupSteps: (item.preconditions ?? []).some(value => value.text) ? 1 : 0,
    stepIds: item.steps.map(step => step.id)}));
  source.scenarios.forEach((scenario, index) => {scenario.caseId = cases[index].id;});
  if (story) {requireThat(jiraStoryRevision(client, await client.issue(story.id)).revision === story.version.revision, 'Jira story changed during test capture.'); source.story = story;}
  return source;
}
export async function checkJiraSourceRevisions(source, management, client) {
  requireThat(source.scope.testManagement === management.provider, 'Test-management provider changed since source capture.');
  const changes = [];
  for (const item of source.cases) {
    const current = await management.readCase(item.id);
    requireThat(current.siteUrl === source.scope.siteUrl && current.project === source.scope.project && current.id === item.id, 'Test source destination changed.');
    if (current.revision !== item.revision || current.fingerprint !== item.nativeFingerprint) changes.push({caseId: item.id, executed: item.revision, current: current.revision, executedContent: item.nativeFingerprint, currentContent: current.fingerprint});
  }
  if (source.story) {
    requireThat(client?.configuration.siteUrl === source.scope.siteUrl && client?.configuration.project === source.scope.project, 'Jira story freshness requires the captured source client.');
    const current = jiraStoryRevision(client, await client.issue(source.story.id));
    if (current.revision !== source.story.version.revision) for (const item of source.cases) {
      let change = changes.find(change => change.caseId === item.id);
      if (!change) {change = {caseId: item.id, executed: item.revision, current: item.revision}; changes.push(change);}
      change.story = {id: source.story.id, executed: source.story.version.revision, current: current.revision};
    }
  }
  return changes;
}
