import {keys, identifier} from '../project-config.mjs';

const requireValue = (condition, message) => {if (!condition) throw new Error(message);};
export const selector = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);
function selections(values) {return Array.isArray(values) && values.length <= 500 && values.every(selector) && new Set(values).size === values.length;}
export function validateContextPolicy(policy) {
  keys(policy, ['includeTypes', 'excludeTypes', 'includeStates', 'excludeStates'], 'context policy');
  for (const name of ['includeTypes', 'excludeTypes']) if (policy[name] !== undefined || name === 'excludeTypes') requireValue(selections(policy[name]), 'Context policy needs distinct type selectors and explicit exclusions.');
  for (const name of ['includeStates', 'excludeStates']) if (policy[name] !== undefined || name === 'excludeStates') {
    requireValue(Array.isArray(policy[name]) && policy[name].length <= 500, 'Context policy needs explicit state exclusions.');
    const seen = new Set();
    for (const rule of policy[name]) {
      keys(rule, ['type', 'states'], 'context state rule');
      requireValue(selector(rule.type) && selections(rule.states) && !seen.has(rule.type), 'Context state rules need distinct types and state selectors.'); seen.add(rule.type);
    }
  }
  return structuredClone(policy);
}
export function validateContextScope(scope = {}) {
  keys(scope, ['areaPath'], 'ADO context scope');
  if (scope.areaPath !== undefined) requireValue(selector(scope.areaPath) && !/['\[\];]/.test(scope.areaPath), 'Invalid ADO context area path.');
  return structuredClone(scope);
}
/** Shape only; live metadata validation belongs to each retrieval, never setup. */
export function validateAdoContextConfiguration(context) {
  keys(context, ['sources'], 'ADO context configuration'); keys(context.sources, Object.keys(context.sources ?? {}), 'ADO context sources');
  requireValue(Object.keys(context.sources).length <= 100, 'Too many ADO context sources.');
  for (const [name, source] of Object.entries(context.sources)) {
    requireValue(identifier(name), 'Invalid ADO context source identifier.'); keys(source, ['scope', 'policy'], 'ADO context source');
    if (source.scope !== undefined) validateContextScope(source.scope);
    if (source.policy !== undefined) validateContextPolicy(source.policy);
  }
}
