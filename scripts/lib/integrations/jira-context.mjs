import {keys} from '../project-config.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {jiraIssueKey} from './jira-config.mjs';
import {selector, metadataChanges, resolveContextPolicy, selected} from './context-policy.mjs';
import {readJiraRequirements, jiraStoryRevision} from './jira-requirements.mjs';

export function validateJiraContextScope(scope = {}) {
  keys(scope, ['issueKeys', 'jql'], 'Jira context scope');
  requireThat(scope.issueKeys === undefined || scope.jql === undefined, 'Choose fixed Jira issue keys or saved JQL.');
  if (scope.issueKeys !== undefined) requireThat(Array.isArray(scope.issueKeys) && scope.issueKeys.length <= 500 && scope.issueKeys.every(jiraIssueKey) && new Set(scope.issueKeys).size === scope.issueKeys.length, 'Jira context needs distinct bounded issue keys.');
  if (scope.jql !== undefined) requireThat(typeof scope.jql === 'string' && scope.jql.trim() && scope.jql.length <= 16000 && !/[\x00-\x1f]/.test(scope.jql), 'Jira context needs bounded selected JQL.');
  return structuredClone(scope);
}

/** Native Jira selection/capture; policy, storage and refresh remain shared. */
export function createJiraContextSource(client) {
  async function metadata() {
    const project = await client.projectIdentity(), rows = await client.read(`project/${project.key}/statuses`);
    requireThat(Array.isArray(rows) && rows.length > 0 && rows.length <= 200, 'Jira context type metadata is incomplete.');
    const types = rows.map(row => {
      requireThat(selector(row.id) && selector(row.name) && Array.isArray(row.statuses) && row.statuses.length > 0 && row.statuses.length <= 200, 'Jira context type metadata is incomplete.');
      const states = row.statuses.map(state => {requireThat(selector(state.id) && selector(state.name), 'Jira context state metadata is incomplete.'); return {id: state.id, name: state.name};});
      requireThat(new Set(states.map(state => state.id)).size === states.length && new Set(states.map(state => state.name)).size === states.length, 'Jira context states are ambiguous.');
      return {id: row.id, name: row.name, states};
    });
    requireThat(new Set(types.map(type => type.id)).size === types.length && new Set(types.map(type => type.name)).size === types.length, 'Jira context types are ambiguous.');
    return {types};
  }
  async function retrieve({scope = {}, policy: input, previousMetadata, includeDiscussion = false, includeHistory = false, attachments = []} = {}) {
    scope = validateJiraContextScope(scope);
    const current = await metadata(), changes = metadataChanges(previousMetadata, current);
    if (scope.issueKeys === undefined && scope.jql === undefined) return {status: 'SELECTION_REQUIRED', metadata: current, metadataChanges: changes, choices: [{label: 'Select fixed issue keys'}, {label: 'Save JQL criteria'}]};
    if (input === undefined && scope.issueKeys !== undefined) input = {excludeTypes: [], excludeStates: []};
    if (input === undefined) return {status: 'SELECTION_REQUIRED', metadata: current, metadataChanges: changes, choices: [{label: 'Exclude nothing', policy: {excludeTypes: [], excludeStates: []}}, ...current.types.map(type => ({label: type.name, type: type.id, states: type.states}))]};
    const {policy, repairs} = resolveContextPolicy(input, current);
    if (repairs.length) return {status: 'POLICY_REPAIR_REQUIRED', metadata: current, metadataChanges: changes, policy, repairs};
    const decisions = [], initial = new Map(), unavailable = [];
    if (scope.issueKeys !== undefined) {
      requireThat(scope.issueKeys.every(key => key.startsWith(client.configuration.project + '-')), 'Jira context keys must belong to the configured project.');
      for (const key of scope.issueKeys) {
        try {initial.set(key, await client.issue(key));}
        catch {const missing = {id: key, included: true, reason: 'selected-item-unavailable'}; decisions.push(missing); unavailable.push(missing);}
      }
    } else {
      const rows = await client.search(scope.jql, {fields: ['project', 'issuetype', 'status', 'updated'], maxItems: 10000});
      requireThat(Array.isArray(rows) && rows.length <= 10000, 'Jira context search is incomplete.');
      for (const item of rows) {requireThat(!initial.has(item.key), 'Jira context search contains duplicate issue keys.'); initial.set(item.key, item);}
    }
    for (const [key, item] of initial) {
      await client.requireIssueProject(item);
      const type = current.types.find(type => type.id === item.fields?.issuetype?.id), state = type?.states.find(state => state.id === item.fields?.status?.id);
      requireThat(type && state && typeof item.fields.updated === 'string' && Number.isFinite(Date.parse(item.fields.updated)), 'Jira context classification is incomplete or metadata changed.');
      const reason = selected(policy, type, state); decisions.push({id: key, updated: item.fields.updated, type: type.id, state: state.id, included: reason === 'included', reason});
    }
    decisions.sort((a, b) => a.id.localeCompare(b.id)); const items = [];
    for (const decision of decisions.filter(item => item.included && item.reason !== 'selected-item-unavailable')) {
      try {
        const selectedAttachments = attachments.filter(item => item.issueKey === decision.id);
        const captured = await readJiraRequirements(client, {storyId: decision.id, includeDiscussion, includeHistory, attachmentIds: selectedAttachments.map(item => item.attachmentId), attachments: selectedAttachments.filter(item => item.extraction).map(({attachmentId, extraction}) => ({attachmentId, extraction}))});
        // Re-read selected identity/version after native content and child evidence reads.
        const item = await client.issue(decision.id), story = captured.revisions.find(revision => revision.id === 'jira-story');
        requireThat(item.fields.updated === decision.updated && item.fields.issuetype?.id === decision.type && item.fields.status?.id === decision.state && story?.content === jiraStoryRevision(client, item, {attachmentIds: selectedAttachments.map(item => item.attachmentId)}).content, 'Jira context item changed during capture.');
        const relations = (item.fields.issuelinks ?? []).flatMap(link => {
          const target = link.outwardIssue ?? link.inwardIssue, relation = link.type?.id ?? link.type?.name;
          return jiraIssueKey(target?.key) && selector(relation) && decisions.some(value => value.id === target.key && value.included) ? [{relation, workItemId: target.key}] : [];
        });
        items.push({id: decision.id, captured, relations});
      } catch {unavailable.push(decision);}
    }
    return {status: 'READY', scope, policy, metadata: current, metadataChanges: changes, items, unavailable,
      selection: {complete: unavailable.length === 0, includedCount: decisions.filter(item => item.included).length, excludedCount: decisions.filter(item => !item.included).length, items: decisions}};
  }
  return Object.freeze({metadata, retrieve});
}
