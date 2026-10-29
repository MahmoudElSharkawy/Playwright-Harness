import {adoId, requireValue} from './config.mjs';
import {validateContextScope, selector, metadataChanges, resolveContextPolicy, selected} from './context-policy.mjs';
export {validateContextPolicy, validateContextScope, resolveContextPolicy} from './context-policy.mjs';

const classification = ['System.Id', 'System.Rev', 'System.TeamProject', 'System.WorkItemType', 'System.State', 'System.AreaPath'];
const find = (values, key) => values.find(value => value.id === key) ?? values.find(value => value.name === key);
const inScope = (fields, scope) => !scope.areaPath || typeof fields['System.AreaPath'] === 'string' && (fields['System.AreaPath'].toLowerCase() === scope.areaPath.toLowerCase() || fields['System.AreaPath'].toLowerCase().startsWith(`${scope.areaPath.toLowerCase()}\\`));

/** Context selection is separate from test selection; every operation is read-only. */
export function createAdoContextSource(client) {
  async function metadata() {
    const rows = await client.list('wit/workitemtypes?api-version=7.1');
    requireValue(rows.length > 0 && rows.length <= 200, 'ADO context type metadata is incomplete.');
    const types = [];
    for (const row of rows) {
      requireValue(selector(row.name) && (row.referenceName === undefined || selector(row.referenceName)), 'ADO context type metadata is incomplete.');
      const entries = await client.list(`wit/workitemtypes/${encodeURIComponent(row.name)}/states?api-version=7.1`);
      requireValue(entries.length > 0 && entries.length <= 200 && entries.every(state => selector(state.name) && (state.id === undefined || selector(state.id))), 'ADO context state metadata is incomplete.');
      const states = entries.map(state => ({id: state.id ?? state.name, name: state.name}));
      requireValue(new Set(states.map(state => state.id)).size === states.length && new Set(states.map(state => state.name)).size === states.length, 'ADO context states are ambiguous.');
      types.push({id: row.referenceName ?? row.name, name: row.name, states});
    }
    requireValue(new Set(types.map(type => type.id)).size === types.length && new Set(types.map(type => type.name)).size === types.length, 'ADO context types are ambiguous.');
    return {types};
  }
  async function retrieve({policy: input, scope = {}, previousMetadata, reuse = () => false, allowPartial = false} = {}) {
    scope = validateContextScope(scope);
    // An explicit ID list already selects the source set; no broad policy is inferred.
    if (input === undefined && scope.workItemIds !== undefined) input = {excludeTypes: [], excludeStates: []};
    const current = await metadata(), changes = metadataChanges(previousMetadata, current);
    if (input === undefined) return {status: 'SELECTION_REQUIRED', metadata: current, metadataChanges: changes,
      choices: [{label: 'Exclude nothing', policy: {excludeTypes: [], excludeStates: []}}, ...current.types.map(type => ({label: type.name, type: type.id, states: type.states}))]};
    const {policy, repairs} = resolveContextPolicy(input, current);
    if (repairs.length) return {status: 'POLICY_REPAIR_REQUIRED', metadata: current, metadataChanges: changes, repairs, policy};
    const ids = [...(scope.workItemIds ?? [])].sort((a, b) => a - b); let cursor = 0;
    for (let page = 0; scope.workItemIds === undefined; page++) {
      requireValue(page <= 100, 'ADO context query exceeds 20000 items; narrow the scope.');
      const result = await client.wiql(`SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] > ${cursor}${scope.areaPath ? ` AND [System.AreaPath] UNDER '${scope.areaPath}'` : ''} ORDER BY [System.Id]`, {top: 200});
      requireValue(Array.isArray(result.workItems) && result.workItems.length <= 200, 'ADO context query is incomplete or exceeds its page bound.');
      const pageIds = result.workItems.map(item => adoId(item.id));
      requireValue(pageIds.every((id, index) => id > (index ? pageIds[index - 1] : cursor)), 'ADO context pagination did not advance.');
      ids.push(...pageIds); requireValue(ids.length <= 20000, 'ADO context exceeds 20000 items; narrow the scope.');
      if (pageIds.length < 200) break;
      cursor = pageIds.at(-1);
    }
    const decisions = [], missing = [];
    for (let start = 0; start < ids.length; start += 200) {
      const page = ids.slice(start, start + 200), response = await client.workItems(page, classification), found = new Set();
      requireValue(Array.isArray(response.value) && (response.value.length === page.length || allowPartial && scope.workItemIds !== undefined && response.value.length < page.length), 'ADO context classification is incomplete.');
      for (const item of response.value) {
        const id = adoId(item.id); requireValue(page.includes(id) && !found.has(id), 'ADO context classification scope mismatch.'); found.add(id);
        await client.requireWorkItemProject(item);
        const rev = item.fields['System.Rev'] ?? item.rev;
        requireValue(Number.isSafeInteger(rev) && rev > 0, 'ADO context revision classification is incomplete.');
        requireValue(!scope.areaPath || selector(item.fields['System.AreaPath']), 'ADO context area scope classification is incomplete.');
        const type = find(current.types, item.fields['System.WorkItemType']), state = type && find(type.states, item.fields['System.State']);
        requireValue(type && state, 'ADO context metadata changed during classification; retrieve again.');
        const reason = inScope(item.fields, scope) ? selected(policy, type, state) : 'outside-area-scope'; decisions.push({id, rev, type: type.id, state: state.id, included: reason === 'included', reason});
      }
      for (const id of page) if (!found.has(id)) missing.push({id, included: true, reason: 'selected-item-unavailable'});
    }
    decisions.push(...missing);
    decisions.sort((a, b) => a.id - b.id);
    const items = [], reused = [], unavailable = [...missing];
    for (const decision of decisions.filter(item => item.included && item.reason !== 'selected-item-unavailable')) {
      if (reuse(decision)) {reused.push(decision); continue;}
      try {
      const item = await client.read(`wit/workitems/${decision.id}?$expand=relations&api-version=7.1`);
      requireValue(adoId(item.id) === decision.id && Number.isSafeInteger(item.rev) && item.rev === decision.rev && item.fields && (item.relations === undefined || Array.isArray(item.relations)), 'ADO context item is incomplete or changed after revision classification.');
      await client.requireWorkItemProject(item);
      requireValue(inScope(item.fields, scope), 'ADO context item moved outside the requested scope; retrieve again.');
      const type = find(current.types, item.fields['System.WorkItemType']), state = type && find(type.states, item.fields['System.State']);
      requireValue(type && state && type.id === decision.type && state.id === decision.state, 'ADO context item changed after selection; retrieve again.');
      items.push(item);
      } catch (error) {if (!allowPartial) throw error; unavailable.push(decision);}
    }
    return {status: 'READY', metadata: current, metadataChanges: changes, policy, scope, items, reused, unavailable,
      selection: {complete: true, includedCount: decisions.filter(item => item.included).length, excludedCount: decisions.filter(item => !item.included).length, items: decisions}};
  }
  return Object.freeze({metadata, retrieve});
}
