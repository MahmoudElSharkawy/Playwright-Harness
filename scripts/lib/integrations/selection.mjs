import {keys} from '../project-config.mjs';
import {readConsumerJson, requireValue, loadAdoConfiguration} from './config.mjs';
import {createAdoClient} from './ado-client.mjs';
import {loadJiraConfiguration} from './jira-config.mjs';
import {createJiraClient} from './jira-client.mjs';
import {createTestManagement} from './test-management.mjs';

/** Resolve only the selected tracker; legacy consumers retain their ADO default. */
export function selectTracker(roots, provider) {
  requireValue(provider === undefined || ['ado', 'jira'].includes(provider), 'Unknown integration provider.');
  const configuration = readConsumerJson(roots, '.harness/integrations.json', true);
  if (configuration === undefined) {
    requireValue(provider !== 'jira', 'Jira is not configured.');
    return 'ado';
  }
  keys(configuration, ['version', 'ado', 'jira', 'defaultProvider'], 'integrations');
  requireValue(configuration.version === 1, 'Integrations need version 1.');
  requireValue(configuration.defaultProvider === undefined || ['ado', 'jira'].includes(configuration.defaultProvider), 'Unknown default integration provider.');
  const selected = provider ?? configuration.defaultProvider ?? (configuration.ado ? 'ado' : 'jira');
  requireValue(configuration[selected] !== undefined, `Selected ${selected} provider is not configured.`);
  return selected;
}

export function trackerProvider(client) {return client.configuration?.siteUrl ? 'jira' : 'ado';}

/** Construction does not make a request or resolve Jira/plugin credentials. */
export function createTrackerClient(roots, options = {}) {
  if (options.client) return options.client;
  const provider = selectTracker(roots, options.provider);
  return provider === 'jira'
    ? createJiraClient({...loadJiraConfiguration(roots, options.environment), roots, fetchImpl: options.fetchImpl})
    : createAdoClient({...loadAdoConfiguration(roots, {}, options.environment), roots, fetchImpl: options.fetchImpl});
}

export function selectedTestManagement(roots, jira, options = {}) {
  if (options.management) return options.management;
  const resolveCredentials = options.resolveTestManagementCredentials ?? loadJiraConfiguration(roots, options.environment).resolveTestManagementCredentials;
  return createTestManagement({jira, roots, resolveCredentials, fetchImpl: options.fetchImpl});
}
