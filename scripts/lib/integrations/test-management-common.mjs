import {data, fingerprint, requireThat} from '../execution-core/data.mjs';
import {createDelivery, externalIdentity} from './delivery.mjs';
import {PluginError} from './plugin-client.mjs';
import {JiraError} from './jira-client.mjs';

export const capabilities = Object.freeze({remoteCases: true, remoteResults: true, automationIdentity: true});
export const content = item => ({title: item.title, steps: item.steps.map(({action, data = '', expected}) => ({action, data, expected}))});
export function desiredCase(input) {
  requireThat(typeof input.title === 'string' && input.title.trim() && input.title.length <= 255, 'Test case needs a bounded title.');
  requireThat(typeof input.marker === 'string' && /^pom-harness-[a-z0-9-]{16,80}$/.test(input.marker), 'Case delivery needs its stable owned operation marker.');
  requireThat(Array.isArray(input.steps) && input.steps.length > 0 && input.steps.length <= 500, 'Test case needs 1–500 ordered steps.');
  const steps = input.steps.map(step => {
    requireThat(step && typeof step.action === 'string' && step.action.trim() && typeof step.expected === 'string' && step.expected.trim() && (step.data === undefined || typeof step.data === 'string'), 'Each case step needs an action and an expected result.');
    return {action: step.action, data: step.data ?? '', expected: step.expected};
  });
  requireThat(input.labels === undefined || Array.isArray(input.labels) && input.labels.length <= 100 && input.labels.every(label => typeof label === 'string' && /^[A-Za-z0-9_.:-]{1,255}$/.test(label)), 'Invalid test-case labels.');
  requireThat(input.removeLabels === undefined || Array.isArray(input.removeLabels) && input.removeLabels.length <= 100 && input.removeLabels.every(label => typeof label === 'string' && /^[A-Za-z0-9_.:-]{1,255}$/.test(label)), 'Invalid reviewed label removals.');
  const removed = new Set((input.removeLabels ?? []).map(label => label.toLowerCase()));
  return data({title: input.title, steps, labels: [...new Set([...(input.before?.labels ?? []).filter(label => !removed.has(label.toLowerCase())), ...(input.labels ?? []), input.marker])]}, 2 * 1024 * 1024);
}
export function verifiedContent(plan, item) {
  requireThat(fingerprint(content(item)) === fingerprint(content(plan.desired)) && fingerprint([...item.labels].sort()) === fingerprint([...plan.desired.labels].sort()) && item.labels.includes(plan.marker), 'Case readback differs from approved ordered content, labels or operation marker.');
  return item;
}
export function automationIdentity(value) {
  requireThat(value && ['name', 'storage', 'type', 'id'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 500 && !/[\x00-\x1f]/.test(value[key])), 'Automation needs durable name, storage, type and identity.');
  requireThat(!/^(?:[A-Za-z]:|[\\/])/.test(value.storage) && !value.storage.replace(/\\/g, '/').split('/').includes('..'), 'Automation storage must remain a relative source path.');
  return data(Object.fromEntries(['name', 'storage', 'type', 'id'].map(key => [key, value[key]])));
}
export function mappedStatus(outcome, mapping, available) {
  requireThat(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'REVIEW_REQUIRED'].includes(outcome), 'Unknown neutral test outcome.');
  const name = mapping?.[outcome];
  requireThat(typeof name === 'string' && available.some(status => status.name === name && status.archived !== true), `Select an available native status for ${outcome}.`);
  return name;
}
export function validateResults(results) {
  requireThat(Array.isArray(results) && results.length > 0 && results.length <= 500 && new Set(results.map(row => row.caseId)).size === results.length, 'Select distinct bounded case results.');
  return data(results, 2 * 1024 * 1024);
}
export function nativeRequest(operation, route, method, body, channel = 'plugin') {
  return {operation, channel, route, method, ...(body === undefined ? {} : {body})};
}
export async function writeRequest(delivery, request, options = {}) {
  return delivery.write(request.operation, `${request.channel}/${request.route}`, request.body, {method: request.method, ...options});
}

/** One receipt spans both Jira metadata and native plugin writes. */
export function testManagementDelivery({jira, transport, roots, provider}, kind, execute, sourceFingerprint) {
  function destination(route) {
    requireThat(typeof route === 'string' && /^(?:jira|plugin)\//.test(route), 'Invalid native delivery route.');
    const slash = route.indexOf('/'), channel = route.slice(0, slash), native = route.slice(slash + 1);
    if (channel === 'plugin') return transport.destination(native);
    let decoded = native; try {for (let round = 0; round < 5 && decoded.includes('%'); round++) decoded = decodeURIComponent(decoded);} catch {throw new Error('Invalid Jira delivery route encoding.');}
    requireThat(/^[A-Za-z]/.test(native) && !/[\\#\x00-\x20]/.test(native) && !decoded.includes('..') && !decoded.includes('://'), 'Invalid Jira delivery destination.');
    return `${jira.configuration.siteUrl}/rest/api/3/${native}`;
  }
  return createDelivery({roots, provider, kind, execute, sourceFingerprint, base: `${jira.configuration.siteUrl}/${jira.configuration.project}/${provider}`, destination,
    send(route, options) {const slash = route.indexOf('/'); return route.startsWith('jira/') ? jira.request(route.slice(slash + 1), {...options, execute: true}) : transport.request(route.slice(slash + 1), {...options, execute: true});},
    identityFor(operation, value) {
      const item = value?.createTest?.test ?? value?.createTestExecution?.testExecution ?? value;
      const id = operation === 'create-result' ? item?.id : item?.key ?? item?.jira?.key ?? item?.issueId ?? item?.id;
      return externalIdentity(id) ? {externalId: id} : undefined;
    }, isRemoteError: error => error instanceof PluginError || error instanceof JiraError});
}
