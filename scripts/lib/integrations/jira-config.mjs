import {consumerEnvironment} from '../consumer-env.mjs';
import {keys, identifier} from '../project-config.mjs';
import {readConsumerJson, requireValue} from './config.mjs';
import {validateContextPolicy} from './context-policy.mjs';

const reference = value => typeof value === 'string' && /^[A-Z_][A-Z0-9_]{0,99}$/.test(value);
const projectKey = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(value);
export const jiraIssueKey = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,99}-[1-9]\d{0,19}$/.test(value);

export function validateJiraConfiguration(input) {
  keys(input, ['siteUrl', 'project', 'emailRef', 'credentialRef', 'authType', 'cloudId', 'timeoutMs', 'maxResponseBytes', 'fields', 'issueTypes', 'testManagement', 'context', 'bugs'], 'Jira configuration');
  let site; try {site = new URL(input.siteUrl);} catch {throw new Error('Configure an explicit Jira Cloud site URL.');}
  requireValue(site.protocol === 'https:' && /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(site.hostname) && !site.port && !site.username && !site.password && !site.search && !site.hash && site.pathname === '/', 'Jira Cloud site must be an HTTPS atlassian.net origin without credentials, port or path.');
  requireValue(projectKey(input.project), 'Jira project must be an explicit project key.');
  requireValue(reference(input.emailRef) && reference(input.credentialRef), 'Jira credentials require email and API-token environment references.');
  const authType = input.authType ?? 'classic';
  requireValue(['classic', 'scoped'].includes(authType), 'Jira authentication must be classic or scoped API token.');
  requireValue(authType === 'scoped' ? typeof input.cloudId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.cloudId) : input.cloudId === undefined, 'Scoped Jira tokens require a cloud ID; classic tokens use the configured site.');
  const timeoutMs = input.timeoutMs ?? 30000, maxResponseBytes = input.maxResponseBytes ?? 2 * 1024 * 1024;
  requireValue(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 60000, 'Jira timeout must be 10–60000 ms.');
  requireValue(Number.isInteger(maxResponseBytes) && maxResponseBytes >= 128 && maxResponseBytes <= 8 * 1024 * 1024, 'Invalid Jira response bound.');
  if (input.fields !== undefined) {
    keys(input.fields, ['acceptanceCriteria'], 'Jira field mappings');
    requireValue(Object.values(input.fields).every(value => typeof value === 'string' && /^(?:[a-z][a-zA-Z0-9]*|customfield_[1-9]\d*)$/.test(value)), 'Jira mappings require stable field IDs.');
  }
  if (input.issueTypes !== undefined) {
    keys(input.issueTypes, ['bug'], 'Jira issue-type mappings');
    requireValue(Object.values(input.issueTypes).every(value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 150 && !/[\x00-\x1f]/.test(value)), 'Invalid Jira issue-type mapping.');
  }
  if (input.bugs !== undefined) {
    keys(input.bugs, ['fields', 'labels', 'storyLink', 'linkType', 'maxAttachmentBytes'], 'Jira bug configuration');
    if (input.bugs.fields !== undefined) {
      requireValue(input.bugs.fields && typeof input.bugs.fields === 'object' && !Array.isArray(input.bugs.fields) && Object.keys(input.bugs.fields).length <= 100 && Object.keys(input.bugs.fields).every(name => /^(?:[a-z][a-zA-Z0-9]*|customfield_[1-9]\d*)$/.test(name)) && Buffer.byteLength(JSON.stringify(input.bugs.fields)) <= 128 * 1024, 'Jira bug fields must be bounded native field defaults.');
    }
    if (input.bugs.labels !== undefined) requireValue(Array.isArray(input.bugs.labels) && input.bugs.labels.length <= 30 && input.bugs.labels.every(value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value)), 'Jira bug labels must be bounded labels.');
    if (input.bugs.storyLink !== undefined) requireValue(typeof input.bugs.storyLink === 'boolean', 'Jira bug storyLink must be boolean.');
    if (input.bugs.linkType !== undefined) requireValue(typeof input.bugs.linkType === 'string' && input.bugs.linkType.trim() && input.bugs.linkType.length <= 150 && !/[\x00-\x1f]/.test(input.bugs.linkType), 'Jira bug links need an explicit issue-link type ID or name.');
    if (input.bugs.maxAttachmentBytes !== undefined) requireValue(Number.isSafeInteger(input.bugs.maxAttachmentBytes) && input.bugs.maxAttachmentBytes > 0 && input.bugs.maxAttachmentBytes <= 8 * 1024 * 1024, 'Jira bug attachments must be bounded to 8 MiB.');
  }
  const testManagement = input.testManagement ?? {provider: 'none'};
  requireValue(testManagement && ['none', 'xray', 'zephyr-scale'].includes(testManagement.provider), 'Select none, xray or zephyr-scale test management.');
  const pluginFields = {none: ['provider'], xray: ['provider', 'clientIdRef', 'clientSecretRef'], 'zephyr-scale': ['provider', 'credentialRef', 'region']};
  keys(testManagement, pluginFields[testManagement.provider], 'Jira test-management configuration');
  if (testManagement.provider === 'xray') requireValue(reference(testManagement.clientIdRef) && reference(testManagement.clientSecretRef), 'Xray requires client ID and secret references.');
  if (testManagement.provider === 'zephyr-scale') requireValue(reference(testManagement.credentialRef) && ['eu', 'us'].includes(testManagement.region), 'Zephyr Scale requires an API-token reference and eu/us region.');
  if (input.context !== undefined) {
    keys(input.context, ['sources'], 'Jira context configuration'); keys(input.context.sources, Object.keys(input.context.sources ?? {}), 'Jira context sources');
    requireValue(Object.keys(input.context.sources).length <= 100, 'Too many Jira context sources.');
    for (const [name, source] of Object.entries(input.context.sources)) {
      requireValue(identifier(name), 'Invalid Jira context source identifier.'); keys(source, ['scope', 'policy'], 'Jira context source');
      if (source.policy !== undefined) validateContextPolicy(source.policy);
      if (source.scope !== undefined) {
        keys(source.scope, ['issueKeys', 'jql'], 'Jira context selection');
        requireValue(source.scope.issueKeys === undefined || source.scope.jql === undefined, 'Choose fixed issue keys or saved JQL selection.');
        if (source.scope.issueKeys !== undefined) requireValue(Array.isArray(source.scope.issueKeys) && source.scope.issueKeys.length <= 500 && new Set(source.scope.issueKeys).size === source.scope.issueKeys.length && source.scope.issueKeys.every(key => jiraIssueKey(key) && key.startsWith(input.project + '-')), 'Jira fixed selection needs distinct keys in the configured project.');
        if (source.scope.jql !== undefined) requireValue(typeof source.scope.jql === 'string' && source.scope.jql.trim() && source.scope.jql.length <= 16000 && !/[\x00-\x1f]/.test(source.scope.jql), 'Jira saved criteria must be bounded JQL.');
      }
    }
  }
  return Object.freeze({...structuredClone(input), siteUrl: site.origin, authType, timeoutMs, maxResponseBytes, testManagement: Object.freeze({...testManagement})});
}

/** Selecting Jira reads only non-secret configuration; credentials remain lazy. */
export function loadJiraConfiguration(roots, shellEnvironment = process.env) {
  const modern = readConsumerJson(roots, '.harness/integrations.json', true);
  keys(modern, ['version', 'ado', 'jira', 'defaultProvider'], 'integrations');
  requireValue(modern.version === 1 && modern.jira && (modern.defaultProvider === undefined || ['ado', 'jira'].includes(modern.defaultProvider)), 'Integrations need version 1 and an explicit jira section.');
  const configuration = validateJiraConfiguration(modern.jira);
  let environment; const value = name => (environment ??= consumerEnvironment(roots, shellEnvironment))[name];
  return {configuration, resolveEmail: () => value(configuration.emailRef), resolveCredential: () => value(configuration.credentialRef),
    resolveTestManagementCredentials() {
      const plugin = configuration.testManagement;
      if (plugin.provider === 'xray') return {clientId: value(plugin.clientIdRef), clientSecret: value(plugin.clientSecretRef)};
      if (plugin.provider === 'zephyr-scale') return {token: value(plugin.credentialRef)};
      return {};
    }};
}
