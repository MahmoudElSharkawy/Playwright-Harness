import {requireValue} from './config.mjs';
import {jiraIssueKey} from './jira-config.mjs';
import {fingerprint} from '../execution-core/data.mjs';

const snapshot = item => fingerprint({id: item.id, key: item.key, updated: item.fields.updated, project: item.fields.project, labels: item.fields.labels ?? [], parent: item.fields.parent ?? null, links: (item.fields.issuelinks ?? []).map(linkIdentity)});
const linkIdentity = link => ({id: String(link.id), type: String(link.type?.id), inward: link.inwardIssue?.key ?? null, outward: link.outwardIssue?.key ?? null});

/** Jira issue metadata only; case content and test results belong to the selected plugin. */
export function createJiraWorkItems(client) {
  function key(value) {requireValue(jiraIssueKey(value) && value.startsWith(client.configuration.project + '-'), 'Select an issue key in the configured Jira project.'); return value;}
  async function prepare({id, tag, storyId, linkTypeId}) {
    const item = await client.issue(key(id)), requests = [], desired = {}, beforeLinks = (item.fields.issuelinks ?? []).map(linkIdentity);
    requireValue(Array.isArray(item.fields.labels ?? []) && Array.isArray(item.fields.issuelinks ?? []), 'Jira labels or links are incomplete.');
    if (tag !== undefined) {
      requireValue(typeof tag === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(tag), 'Supply one bounded Jira label.');
      desired.labels = [...new Set([...(item.fields.labels ?? []), tag])];
      if (!(item.fields.labels ?? []).includes(tag)) {
        const meta = await client.read(`issue/${id}/editmeta`); requireValue(meta.fields?.labels?.operations?.includes('set'), 'Jira labels are not editable for this issue.');
        requests.push({operation: 'update-labels', route: `issue/${id}`, method: 'PUT', body: {fields: {labels: desired.labels}}});
      }
    } else {
      const story = await client.issue(key(storyId)); requireValue(story.key !== item.key, 'An issue cannot relate to itself.');
      const definitions = await client.read('issueLinkType');
      requireValue(Array.isArray(definitions.issueLinkTypes), 'Jira link-type metadata is incomplete.');
      const types = definitions.issueLinkTypes.filter(type => linkTypeId ? String(type.id) === String(linkTypeId) : type.inward?.toLowerCase() === 'relates to' && type.outward?.toLowerCase() === 'relates to');
      requireValue(types.length === 1, 'Select one available Jira related link type with --link-type.');
      desired.storyId = storyId; desired.linkTypeId = String(types[0].id);
      const parent = item.fields.parent?.key === storyId, related = beforeLinks.some(link => link.type === desired.linkTypeId && [link.inward, link.outward].includes(storyId));
      requireValue(parent || related, 'Selected Jira issue has no matching parent or related story link.');
      if (parent) {
        const meta = await client.read(`issue/${id}/editmeta`);
        requireValue(item.fields.issuetype?.subtask === false && meta.fields?.parent?.required === false && meta.fields.parent.operations?.includes('set'), 'Jira requires this parent or does not permit removing it; review the issue hierarchy natively.');
      }
      if (!related) requests.push({operation: 'link-related-story', route: 'issueLink', method: 'POST', body: {type: {id: desired.linkTypeId}, inwardIssue: {key: id}, outwardIssue: {key: storyId}}});
      if (parent) requests.push({operation: 'remove-story-parent', route: `issue/${id}`, method: 'PUT', body: {update: {parent: [{set: {none: true}}]}}});
    }
    return {id, beforeFingerprint: snapshot(item), beforeLabels: item.fields.labels ?? [], beforeParent: item.fields.parent?.key ?? null, beforeLinks, desired, requests};
  }
  async function write(plan, delivery) {
    requireValue(snapshot(await client.issue(key(plan.id))) === plan.beforeFingerprint, 'Jira issue changed after preview; refresh and renew approval.');
    for (const request of plan.requests) await delivery.write(request.operation, request.route, request.body, {method: request.method});
  }
  async function verify(plan) {
    const item = await client.issue(key(plan.id)), links = (item.fields.issuelinks ?? []).map(linkIdentity);
    if (plan.desired.labels) requireValue(fingerprint([...(item.fields.labels ?? [])].sort()) === fingerprint([...plan.desired.labels].sort()), 'Jira label readback differs from approval.');
    else requireValue(item.fields.parent?.key !== plan.desired.storyId && links.some(link => link.type === plan.desired.linkTypeId && [link.inward, link.outward].includes(plan.desired.storyId)), 'Jira story relation readback differs from approval.');
    requireValue(plan.beforeLinks.every(link => links.some(value => fingerprint(value) === fingerprint(link))), 'Jira relation update removed an unrelated link.');
    return item;
  }
  async function completion(plan) {
    const item = await client.issue(key(plan.id)), requests = [], links = (item.fields.issuelinks ?? []).map(linkIdentity);
    requireValue(plan.beforeLinks.every(link => links.some(value => fingerprint(value) === fingerprint(link))), 'Jira links changed outside the approved update.');
    if (plan.desired.labels) {
      const actual = fingerprint([...(item.fields.labels ?? [])].sort()), desired = fingerprint([...plan.desired.labels].sort());
      requireValue(actual === desired || actual === fingerprint([...plan.beforeLabels].sort()), 'Jira labels changed outside the approved update.');
      if (actual !== desired) requests.push(...plan.requests);
    } else {
      const parent = item.fields.parent?.key ?? null;
      requireValue(parent === plan.beforeParent || parent === null, 'Jira parent changed outside the approved update.');
      const related = links.filter(link => link.type === plan.desired.linkTypeId && [link.inward, link.outward].includes(plan.desired.storyId));
      requireValue(related.length <= 1, 'Jira related link is ambiguous.');
      if (!related.length) requests.push(...plan.requests.filter(request => request.operation === 'link-related-story'));
      if (parent === plan.desired.storyId) requests.push(...plan.requests.filter(request => request.operation === 'remove-story-parent'));
    }
    return {complete: requests.length === 0, requests};
  }
  return {prepare, write, verify, completion};
}
