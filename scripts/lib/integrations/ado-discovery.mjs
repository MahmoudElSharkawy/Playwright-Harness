import {contextData} from '../context/model.mjs';
import {keys, requireThat} from '../execution-core/data.mjs';
import {htmlToText, parseStepsXml} from './ado-steps.mjs';
import {adoId} from './config.mjs';

const SUMMARY_LIMIT = 12;
const DETAIL_LIMIT = 5;
const SUMMARY_FIELDS = ['System.Title', 'System.State', 'System.TeamProject', 'System.WorkItemType', 'System.AreaPath'];
const STEPS = 'Microsoft.VSTS.TCM.Steps';
const quote = value => `'${value.replaceAll("'", "''")}'`;
const folded = value => String(value ?? '').toLowerCase();

export const caseDiscoveryFields = {'System.Description': 'html', [STEPS]: 'html'};

/** Two read-only stages. Search never chooses an item or grants write authority. */
export async function discoverWorkItems(client, input, {types, fields, areaPath, captured = [], related = []}) {
  keys(input, ['queries', 'ids'], 'ADO discovery');
  const details = input.ids !== undefined;
  requireThat(details !== (input.queries !== undefined), 'Supply either query groups or selected candidate IDs.');
  const selected = details ? input.ids : [];
  const queries = details ? [] : input.queries;
  if (details) requireThat(Array.isArray(selected) && selected.length >= 1 && selected.length <= DETAIL_LIMIT && new Set(selected.map(adoId)).size === selected.length, 'Select one to five unique candidate IDs.');
  else requireThat(Array.isArray(queries) && queries.length >= 1 && queries.length <= 2 && queries.every(group => Array.isArray(group) && group.length >= 1 && group.length <= 4 && group.every(term => typeof term === 'string' && term.trim() && term.length <= 100 && !/[\x00-\x1f]/.test(term))), 'Select one or two query groups with up to four short search terms each.');
  contextData(input, 8192);
  requireThat(Object.keys(fields).every(name => /^[A-Za-z][A-Za-z0-9_.]{0,199}$/.test(name)), 'Discovery requires stable content field references.');
  const project = await client.projectIdentity(), area = folded(areaPath), scope = {project: project.name, ...(areaPath ? {areaPath} : {})};
  const typeNames = new Set(types.map(folded));
  const inScope = item => folded(item.fields?.['System.TeamProject']) === folded(project.name) && typeNames.has(folded(item.fields?.['System.WorkItemType'])) &&
    (!area || folded(item.fields['System.AreaPath']) === area || folded(item.fields['System.AreaPath']).startsWith(`${area}\\`));
  const cached = new Map(captured.filter(inScope).map(item => [adoId(item.id), item]));
  const omissions = [], candidates = [];
  let truncated = false;
  let ids;
  if (details) ids = selected.map(adoId);
  else {
    const terms = queries.map(group => group.map(term => folded(term.trim())));
    const linked = [...cached.values()].filter(item => {
      const haystack = ['System.Title', ...Object.keys(fields)].map(field => folded(item.fields[field]));
      return terms.some(group => group.every(term => haystack.some(text => text.includes(term))));
    }).map(item => adoId(item.id));
    const retained = [...new Set([...linked, ...related.map(adoId)])];
    truncated = retained.length > DETAIL_LIMIT;
    const found = new Set(retained.slice(0, DETAIL_LIMIT));
    const where = `[System.TeamProject] = @project AND [System.WorkItemType] IN (${types.map(quote).join(', ')})${areaPath ? ` AND [System.AreaPath] UNDER ${quote(areaPath)}` : ''}`;
    for (const [index, group] of queries.entries()) {
      const search = group.map(term => {
        const literal = quote(term.trim());
        return `(${[`[System.Title] CONTAINS ${literal}`, ...Object.entries(fields).map(([name, type]) => `[${name}] ${type === 'string' ? 'CONTAINS' : 'CONTAINS WORDS'} ${literal}`)].join(' OR ')})`;
      }).join(' AND ');
      try {
        const result = await client.wiql(`SELECT [System.Id] FROM WorkItems WHERE ${where} AND ${search} ORDER BY [System.ChangedDate] DESC, [System.Id] DESC`, {top: SUMMARY_LIMIT + 1});
        requireThat(Array.isArray(result.workItems) && result.workItems.length <= SUMMARY_LIMIT + 1, 'Invalid discovery response.');
        for (const workItemId of result.workItems.map(item => adoId(item.id))) found.add(workItemId);
        truncated ||= result.workItems.length > SUMMARY_LIMIT;
      } catch {omissions.push({query: index + 1, reason: 'search-unavailable'});}
    }
    truncated ||= found.size > SUMMARY_LIMIT;
    ids = [...found].slice(0, SUMMARY_LIMIT);
  }
  const missing = ids.filter(id => !cached.has(id));
  if (missing.length) {
    try {
      const result = await client.workItems(missing, details ? [...SUMMARY_FIELDS, ...Object.keys(fields)] : SUMMARY_FIELDS);
      requireThat(Array.isArray(result.value) && result.value.length <= missing.length, 'Invalid candidate response.');
      const received = result.value.map(item => adoId(item.id));
      requireThat(new Set(received).size === received.length && received.every(id => missing.includes(id)), 'Candidate identities differ from the requested IDs.');
      for (const item of result.value) if (inScope(item)) cached.set(adoId(item.id), item);
    } catch {omissions.push({reason: 'candidate-read-unavailable'});}
  }
  for (const id of ids) {
    const item = cached.get(id);
    if (!item) {omissions.push({id, reason: 'unavailable-or-out-of-scope'}); continue;}
    try {
      const title = item.fields['System.Title'], state = item.fields['System.State'] ?? null;
      requireThat(typeof title === 'string' && title.length <= 255 && (state === null || typeof state === 'string' && state.length <= 150), 'Invalid candidate summary.');
      const candidate = {id, title, state};
      if (details) {
        requireThat(Number.isInteger(item.rev) && item.rev > 0, 'Invalid candidate revision.');
        candidate.revision = item.rev;
        candidate.content = {};
        for (const field of Object.keys(fields)) {
          const value = item.fields[field];
          if (typeof value !== 'string' || !value) continue;
          const text = field === STEPS ? parseStepsXml(value).map(step => step.kind === 'sharedRef' ? `Shared step #${step.ref} (not expanded)` : `${step.action}\nExpected: ${step.expected}`).join('\n') : fields[field] === 'html' ? htmlToText(value) : value;
          contextData(text, 2 * 1024 * 1024);
          candidate.content[field] = text.slice(0, 2000);
          truncated ||= text.length > 2000;
        }
      }
      candidates.push(contextData(candidate, 65536));
    } catch {omissions.push({id, reason: 'candidate-content-unavailable'});}
  }
  return {mode: details ? 'details' : 'shortlist', scope, status: omissions.length ? candidates.length ? 'partial' : 'unavailable' : 'complete', truncated, candidates, omissions};
}
