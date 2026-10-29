import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {requirementsClient} from '../requirements/sources.mjs';
import {loadJiraConfiguration} from '../integrations/jira-config.mjs';
import {adoId, workItemLinkId} from '../integrations/config.mjs';
import {prepareCaseOperation, verifyCaseOperation} from '../integrations/ado-case-design.mjs';
import {requestFingerprint as nativeRequestFingerprint} from '../integrations/delivery.mjs';
import {writeRequest} from '../integrations/test-management-common.mjs';
import {preparationSteps, nativeDesignSteps, TEST_TYPES, SCENARIO_TYPES} from './review.mjs';

export const designClient = (roots, origin, options = {}) => requirementsClient(roots, {...options, provider: origin?.provider ?? 'ado'});
export async function designTestManagement(roots, client, origin, options = {}) {
  requireThat(origin.provider === 'jira' && client.configuration.siteUrl === origin.siteUrl && client.configuration.project === origin.project && (client.configuration.testManagement?.provider ?? 'none') === origin.testManagement, 'Selected Jira site, project or test management changed; refresh and renew approval.');
  if (origin.testManagement === 'none') return null;
  const adapter = options.testManagement ?? (await import('../integrations/test-management.mjs')).createTestManagement({jira: client, roots, fetchImpl: options.fetchImpl, resolveCredentials: () => loadJiraConfiguration(roots, options.environment).resolveTestManagementCredentials()});
  requireThat(adapter.provider === origin.testManagement && adapter.capabilities.remoteCases === true, 'Selected test management does not support native cases.'); return adapter;
}
export const operationRequestFingerprint = operation => !operation.request ? null : operation.nativePlan ? fingerprint(operation.nativePlan) : nativeRequestFingerprint(operation.request.route, operation.request.method, operation.request.body);
export const outcomeId = outcome => outcome.externalId ?? outcome.adoId;
export const operationId = operation => operation.externalId ?? operation.adoId;
const caseContent = item => ({title: item.title, steps: item.steps.map(({action, expected, data = ''}) => ({action, expected, data}))});

/** Provider mechanics only. Review, approval, freshness and state transitions stay shared. */
export async function createDesignTarget(roots, origin, options = {}) {
  const client = designClient(roots, origin, options), project = await client.projectIdentity();
  if (origin.provider !== 'jira') {
    requireThat(origin.organizationUrl === client.configuration.organizationUrl && origin.projectId.toLowerCase() === project.id.toLowerCase(), 'Source and configured publication destination differ.');
    return {client, project, destination: {organizationUrl: client.configuration.organizationUrl, projectId: project.id, project: project.name, storyId: origin.storyId},
      prepare: (state, row) => prepareCaseOperation(client, state, row), verify: (operation, id, options) => verifyCaseOperation(client, operation, id, options),
      delivery: approval => client.delivery('case-design', true, approval),
      async write(operation, delivery, onIdentity) {const item = await delivery.write(operation.adoId ? 'edit-case' : 'create-case', operation.request.route, operation.request.body, {method: operation.request.method, patch: true, onIdentity: value => onIdentity({adoId: value.workItemId})}); return adoId(item.id);},
      outcome: item => ({adoId: item.id, revision: item.rev, url: `${origin.organizationUrl}/${encodeURIComponent(project.name)}/_workitems/edit/${item.id}`}), verified: item => ({workItemId: item.id, revision: item.rev}),
      async candidates() {const story = await client.read(`wit/workitems/${origin.storyId}?$expand=relations&api-version=7.1`); await client.requireWorkItemProject(story); const ids = [...new Set((story.relations ?? []).filter(row => row.rel === 'Microsoft.VSTS.Common.TestedBy-Forward').map(row => workItemLinkId(row.url, origin.organizationUrl, project)).filter(Boolean))]; requireThat(ids.length <= 500, 'Recovery candidates exceed selected-story bounds.'); return ids;}};
  }
  requireThat(String(project.id) === origin.projectId, 'Jira project identity changed; refresh and renew approval.');
  const management = await designTestManagement(roots, client, origin, options), destination = {...origin, ...(!management ? {provider: 'local', tracker: 'jira'} : {})};
  return {client, project, destination, local: !management,
    async prepare(state, row) {
      const identity = fingerprint({consumer: state.consumer, proposal: state.proposal, caseId: row.id}), before = state.evidence.existing.find(item => String(item.id) === row.id);
      const desired = {title: row.title, steps: nativeDesignSteps([...preparationSteps(row, state.draft.preparations.find(item => item.caseId === row.id)), ...row.steps], before)};
      if (row.proposedAction === 'Reuse unchanged') {
        requireThat(before && fingerprint(caseContent(before)) === fingerprint(desired), 'Reuse unchanged needs the exact captured title and ordered preparation/business steps.');
        if (management) {
          requireThat((await management.readCase(before.id)).fingerprint === before.fingerprint, 'Existing native case changed; refresh and renew approval.');
          const classifications = (before.labels ?? []).filter(label => [...TEST_TYPES, ...SCENARIO_TYPES].some(value => value.toLowerCase() === label.toLowerCase())).map(label => label.toLowerCase()).sort();
          requireThat(fingerprint(classifications) === fingerprint([row.testType.toLowerCase(), row.scenarioType.toLowerCase()].sort()), 'Reuse unchanged requires the same native test and scenario classifications.');
        }
        return {caseId: row.id, identity, provider: management?.provider ?? 'local', ...(management ? {externalId: before.id} : {}), revision: before.revision, beforeFingerprint: before.fingerprint, desired, request: null};
      }
      if (!management) return {caseId: row.id, identity, provider: 'local', revision: identity, desired, request: null};
      const nativePlan = await management.prepareCase({...(before ? {before} : {}), ...desired, storyKey: origin.storyId, marker: 'pom-harness-' + identity, removeLabels: [...TEST_TYPES, ...SCENARIO_TYPES], labels: [row.testType, row.scenarioType]});
      return {caseId: row.id, identity, provider: management.provider, ...(before ? {externalId: before.id, revision: before.revision} : {}), nativePlan, request: {fingerprint: fingerprint(nativePlan)}};
    },
    async verify(operation, id) {
      if (!management) return {revision: operation.revision};
      if (operation.nativePlan) return management.verifyCase(operation.nativePlan, id);
      const item = await management.readCase(id); requireThat(item.fingerprint === operation.beforeFingerprint && fingerprint(caseContent(item)) === fingerprint(operation.desired), 'Reused native case changed.'); return item;
    },
    delivery: approval => management.delivery('case-design', true, approval),
    completion: (operation, id) => management.caseCompletion(operation.nativePlan, id),
    async complete(operation, id, requests, delivery) {for (const request of requests) await writeRequest(delivery, request); return management.verifyCase(operation.nativePlan, id);},
    write: (operation, delivery, onIdentity) => management.writeCase(operation.nativePlan, delivery, {onIdentity: value => typeof value.externalId === 'string' && value.externalId.startsWith(origin.project + '-') && onIdentity({externalId: value.externalId})}),
    outcome: item => management ? {externalId: item.id, revision: item.revision, externalReferences: item.externalReferences} : {local: true, revision: item.revision},
    verified: item => ({externalId: item.id, contentFingerprint: item.fingerprint}),
    async candidates(operation) {if (!management) return []; const found = await management.findCase(operation.nativePlan.marker); return found ? [found.id] : [];}
  };
}
