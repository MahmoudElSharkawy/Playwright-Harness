import {requireValue} from './config.mjs';
import {createPluginClient} from './plugin-client.mjs';
import {createXrayAdapter} from './xray.mjs';
import {createZephyrScaleAdapter} from './zephyr-scale.mjs';

/** Native test-management selection only; workflows and local case storage remain shared. */
export function createTestManagement(options) {
  const provider = options.jira.configuration.testManagement?.provider ?? 'none';
  if (provider === 'none') return Object.freeze({provider, capabilities: Object.freeze({remoteCases: false, remoteResults: false, automationIdentity: false})});
  requireValue(['xray', 'zephyr-scale'].includes(provider), 'Select Xray, Zephyr Scale or no test-management plugin.');
  const transport = options.transport ?? createPluginClient(options);
  return provider === 'xray' ? createXrayAdapter({...options, transport}) : createZephyrScaleAdapter({...options, transport});
}
