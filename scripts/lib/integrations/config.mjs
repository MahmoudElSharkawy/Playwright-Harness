import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {consumerEnvironment} from '../consumer-env.mjs';
import {keys} from '../project-config.mjs';

export function requireValue(condition, message) { if (!condition) throw new Error(message); }
export const adoGuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function adoId(value) {
  requireValue(/^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647, 'ADO IDs must be positive int32 values.');
  return Number(value);
}
/** Relation target ID only in the configured collection's URL forms (as relink matches them); otherwise undefined. */
export function workItemLinkId(url, organizationUrl, project) {
  const value = typeof url === 'string' ? url.replace(/\/$/, '').toLowerCase() : '';
  for (const scope of ['', ...[project.id, project.name].map(part => `/${encodeURIComponent(part)}`)]) {
    const prefix = `${organizationUrl}${scope}/_apis/wit/workitems/`.toLowerCase(), rest = value.slice(prefix.length);
    if (value.startsWith(prefix) && /^[1-9]\d{0,9}$/.test(rest) && Number(rest) <= 2147483647) return Number(rest);
  }
}
export function readConsumerJson(roots, path, optional = false) {
  const file = consumerPath(roots, path);
  if (optional && !existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  requireValue(bytes.length <= 2 * 1024 * 1024, 'Consumer JSON exceeds 2 MiB.');
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Consumer configuration/input must be valid JSON.'); }
}
export function validateAdoConfiguration(input) {
  keys(input, ['organizationUrl', 'project', 'credentialRef', 'repository', 'planId', 'automationField', 'timeoutMs', 'maxResponseBytes', 'bugs'], 'ADO configuration');
  let url; try { url = new URL(input.organizationUrl); } catch { throw new Error('Configure an explicit HTTPS ADO collection URL.'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !/%|\\/.test(url.pathname), 'ADO collection URL must be HTTPS without credentials, escapes, query or fragment.');
  requireValue(typeof input.project === 'string' && /^[^/\\?#%\x00-\x1f]{1,150}$/.test(input.project) && !['.', '..'].includes(input.project), 'Configure an explicit ADO project name or ID.');
  requireValue(typeof input.credentialRef === 'string' && /^[A-Z_][A-Z0-9_]{0,99}$/.test(input.credentialRef), 'ADO credentials must use an environment-variable reference.');
  if (input.repository !== undefined) requireValue(typeof input.repository === 'string' && /^[^/\\?#%\x00-\x1f]{1,150}$/.test(input.repository) && !['.', '..'].includes(input.repository), 'Invalid configured repository.');
  if (input.automationField !== undefined) requireValue(/^Custom\.[A-Za-z][A-Za-z0-9_]*$/.test(input.automationField), 'Optional automation field must be a Custom field reference.');
  if (input.planId !== undefined) adoId(input.planId);
  if (input.bugs !== undefined) {
    keys(input.bugs, ['areaPath', 'iterationPath', 'pathsFrom', 'assignedTo', 'tags', 'storyLink', 'fields', 'maxAttachmentBytes'], 'ADO bug configuration');
    for (const name of ['areaPath', 'iterationPath', 'assignedTo']) if (input.bugs[name] !== undefined) requireValue(typeof input.bugs[name] === 'string' && input.bugs[name].trim() && input.bugs[name].length <= 512 && !/[\r\n\0]/.test(input.bugs[name]), 'Invalid bug field default.');
    if (input.bugs.pathsFrom !== undefined) requireValue(['case', 'story'].includes(input.bugs.pathsFrom), 'Bug pathsFrom must be case or story.');
    if (input.bugs.storyLink !== undefined) requireValue(typeof input.bugs.storyLink === 'boolean', 'Bug storyLink must be boolean.');
    if (input.bugs.tags !== undefined) requireValue(Array.isArray(input.bugs.tags) && input.bugs.tags.length <= 30 && input.bugs.tags.every(tag => typeof tag === 'string' && tag.trim() && tag.length <= 100 && !/[;\r\n]/.test(tag)), 'Invalid bug tags.');
    if (input.bugs.fields !== undefined) requireValue(input.bugs.fields && !Array.isArray(input.bugs.fields) && Object.entries(input.bugs.fields).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_.]+$/.test(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')), 'Bug fields must be scalar field defaults.');
    if (input.bugs.maxAttachmentBytes !== undefined) requireValue(Number.isSafeInteger(input.bugs.maxAttachmentBytes) && input.bugs.maxAttachmentBytes > 0 && input.bugs.maxAttachmentBytes <= 8 * 1024 * 1024, 'Bug attachments must be bounded to 8 MiB.');
  }
  const timeoutMs = input.timeoutMs ?? 30000, maxResponseBytes = input.maxResponseBytes ?? 2 * 1024 * 1024;
  requireValue(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 60000, 'ADO timeout must be 10–60000 ms.');
  requireValue(Number.isInteger(maxResponseBytes) && maxResponseBytes >= 128 && maxResponseBytes <= 8 * 1024 * 1024, 'Invalid ADO response bound.');
  return Object.freeze({...input, organizationUrl: url.href.replace(/\/+$/, ''), timeoutMs, maxResponseBytes});
}

/** Opt-in only. Never read this file, credentials or legacy configuration for a local source. */
export function loadAdoConfiguration(roots, overrides = {}, shellEnvironment = process.env) {
  const environment = consumerEnvironment(roots, shellEnvironment);
  const modern = readConsumerJson(roots, '.harness/integrations.json', true);
  let input;
  if (modern !== undefined) {
    keys(modern, ['version', 'ado'], 'integrations'); requireValue(modern.version === 1 && modern.ado, 'Integrations need version 1 and an explicit ado section.');
    // Modern configuration is authoritative; legacy flags cannot silently rebind a credential.
    requireValue(Object.values(overrides).every(value => value === undefined), 'Use the configured ADO destination; do not combine it with legacy destination overrides.');
    input = modern.ado;
  } else {
    const legacy = readConsumerJson(roots, 'config/project.json', true)?.azure ?? {};
    const org = overrides.org ?? legacy.org ?? environment.AZURE_ORG ?? environment.AZURE_URL;
    const organizationUrl = overrides.organizationUrl ?? legacy.orgUrl ?? (/^https:\/\//i.test(org ?? '') ? org : org ? `https://dev.azure.com/${org}` : undefined);
    input = {organizationUrl, project: overrides.project ?? legacy.project ?? environment.AZURE_PROJECT,
      credentialRef: environment.AZURE_DEVOPS_EXT_PAT ? 'AZURE_DEVOPS_EXT_PAT' : 'AZURE_PAT',
      ...(legacy.repository ? {repository: legacy.repository} : {}), ...(legacy.testPlanId ? {planId: adoId(legacy.testPlanId)} : {}), ...(legacy.automationField ? {automationField: legacy.automationField} : {})};
  }
  const configuration = validateAdoConfiguration(input);
  return {configuration, resolveCredential: () => environment[configuration.credentialRef]};
}
