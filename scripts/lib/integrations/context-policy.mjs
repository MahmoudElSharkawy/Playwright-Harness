import {keys, identifier} from '../project-config.mjs';

const requireValue = (condition, message) => {if (!condition) throw new Error(message);};
export const selector = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);
const find = (values, key) => values.find(value => value.id === key) ?? values.find(value => value.name === key);
const matches = (values, item) => values.some(value => value === item.id || value === item.name);
const metadataEntries = metadata => metadata.types.flatMap(type => [{key: type.id, name: type.name}, ...type.states.map(state => ({key: `${type.id}/${state.id}`, name: state.name}))]);
export function metadataChanges(previous, next) {
  const before = new Map((previous ? metadataEntries(previous) : []).map(item => [item.key, item.name])), after = new Map(metadataEntries(next).map(item => [item.key, item.name]));
  return {added: [...after.keys()].filter(key => !before.has(key)), removed: [...before.keys()].filter(key => !after.has(key)), renamed: [...after].filter(([key, name]) => before.has(key) && before.get(key) !== name).map(([key]) => key)};
}
export function resolveContextPolicy(input, metadata) {
  const policy = validateContextPolicy(input), repairs = [];
  for (const field of ['includeTypes', 'excludeTypes']) if (policy[field]) policy[field] = policy[field].map(key => {const type = find(metadata.types, key); if (!type) repairs.push({field, selector: key}); return type?.id ?? key;});
  for (const field of ['includeStates', 'excludeStates']) for (const rule of policy[field] ?? []) {
    const type = rule.type === '*' ? undefined : find(metadata.types, rule.type);
    if (rule.type !== '*' && !type) {repairs.push({field, type: rule.type}); continue;}
    if (type) rule.type = type.id;
    rule.states = rule.states.map(key => {
      const state = find(type ? type.states : metadata.types.flatMap(value => value.states), key);
      if (!state) repairs.push({field, type: rule.type, selector: key});
      return type ? state?.id ?? key : key;
    });
  }
  return {policy, repairs};
}
export function selected(policy, type, state) {
  const stateMatch = rules => rules.some(rule => (rule.type === '*' || matches([rule.type], type)) && matches(rule.states, state));
  if (matches(policy.excludeTypes, type)) return 'excluded-type';
  if (stateMatch(policy.excludeStates)) return 'excluded-state';
  if (policy.includeTypes !== undefined && !matches(policy.includeTypes, type)) return 'outside-included-types';
  if (policy.includeStates !== undefined && !stateMatch(policy.includeStates)) return 'outside-included-states';
  return 'included';
}
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
  keys(scope, ['areaPath', 'workItemIds'], 'ADO context scope');
  if (scope.areaPath !== undefined) requireValue(selector(scope.areaPath) && !/['\[\];]/.test(scope.areaPath), 'Invalid ADO context area path.');
  if (scope.workItemIds !== undefined) requireValue(Array.isArray(scope.workItemIds) && scope.workItemIds.length <= 20000 && scope.workItemIds.every(id => Number.isSafeInteger(id) && id > 0) && new Set(scope.workItemIds).size === scope.workItemIds.length, 'Context work-item IDs must be distinct positive integers.');
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
