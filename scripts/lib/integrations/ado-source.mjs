import {parseStepsXml, htmlToText} from './ado-steps.mjs';
import {adoId, requireValue} from './config.mjs';
import {validateLocalSource, loadLocalSource} from '../local-source.mjs';

const fields = ['System.Id', 'System.Title', 'System.TeamProject', 'System.State', 'System.Tags', 'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.TCM.Steps', 'Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource'];

export function createAdoTestSource(client) {
  async function batch(ids) {
    const items = new Map();
    for (let start = 0; start < ids.length; start += 200) {
      const scope = ids.slice(start, start + 200), response = await client.workItems(scope, fields);
      requireValue(Array.isArray(response.value) && response.value.length === scope.length, 'ADO omitted required work items.');
      for (const item of response.value) {
        const id = adoId(item.id); requireValue(scope.includes(id) && !items.has(id) && item.fields, 'ADO work-item scope mismatch.');
        await client.requireWorkItemProject(item); items.set(id, item);
      }
    }
    return items;
  }
  return Object.freeze({
    listPlans: () => client.list('testplan/plans?api-version=7.1'),
    listSuites: plan => client.list(`testplan/Plans/${adoId(plan)}/suites?api-version=7.1`),
    async fetchSuite(plan, suite) {
      const planId = adoId(plan), suiteId = adoId(suite);
      const metadata = await client.read(`testplan/Plans/${planId}/suites/${suiteId}?api-version=7.1`);
      requireValue(adoId(metadata.id) === suiteId && typeof metadata.name === 'string', 'ADO suite metadata mismatch.');
      const entries = await client.list(`testplan/Plans/${planId}/Suites/${suiteId}/TestCase?api-version=7.1&excludeFlags=0`);
      const ids = [...new Set(entries.map(entry => adoId(entry.workItem?.id)))];
      requireValue(ids.length > 0 && ids.length <= 500, 'ADO suite needs 1–500 test cases.');
      const items = await batch(ids), shared = new Map();
      async function expand(xml, trail = []) {
        requireValue(trail.length <= 10, 'ADO shared steps exceed the nesting limit.');
        const nodes = parseStepsXml(xml), result = [];
        requireValue(nodes.length > 0, 'ADO steps are absent or unsupported.');
        // Fail on malformed/unrecognized step nodes instead of accepting a partial parse.
        requireValue(nodes.length === (String(xml).match(/<(?:step|compref)\b/g) ?? []).length, 'ADO steps could not be parsed completely.');
        for (const node of nodes) {
          if (node.kind === 'step') result.push(node);
          else {
            requireValue(!trail.includes(node.ref), 'ADO shared steps contain a cycle.');
            if (!shared.has(node.ref)) shared.set(node.ref, (await batch([node.ref])).get(node.ref));
            const item = shared.get(node.ref);
            requireValue(!item.fields['Microsoft.VSTS.TCM.Parameters'] && !item.fields['Microsoft.VSTS.TCM.LocalDataSource'], 'Parameterized shared steps require explicit refinement.');
            result.push(...(await expand(item.fields['Microsoft.VSTS.TCM.Steps'], [...trail, node.ref])).map(step => ({...step, fromShared: node.ref})));
          }
          requireValue(result.length <= 1000 && shared.size <= 500, 'ADO expanded steps exceed scope limits.');
        }
        return result;
      }
      const cases = [];
      for (const id of ids) {
        const f = items.get(id).fields;
        requireValue(typeof f['System.Title'] === 'string' && f['System.Title'].trim(), 'ADO case title is missing.');
        const dataTableXml = f['Microsoft.VSTS.TCM.LocalDataSource'] || null;
        const dataTable = dataTableXml ? [...dataTableXml.matchAll(/<Table1>([\s\S]*?)<\/Table1>/g)].map(row => Object.fromEntries([...row[1].matchAll(/<([^>\/\s]+)>([\s\S]*?)<\/\1>/g)].map(cell => [cell[1], htmlToText(cell[2])]))) : null;
        cases.push({id, title: f['System.Title'], state: f['System.State'] ?? '', priority: f['Microsoft.VSTS.Common.Priority'] ?? null,
          tags: String(f['System.Tags'] ?? '').split(';').map(tag => tag.trim()).filter(Boolean), steps: await expand(f['Microsoft.VSTS.TCM.Steps']),
          parameters: f['Microsoft.VSTS.TCM.Parameters'] || null, dataTable, ...(dataTableXml ? {dataTableXml} : {})});
      }
      return {planId, suiteId, suiteName: metadata.name, organizationUrl: client.configuration.organizationUrl, project: client.configuration.project, cases};
    }
  });
}

/** Explicit refinement is required where the neutral v1 source cannot preserve parameter semantics. */
export function adoSuiteToSource(suite) {
  const source = {version: 1, id: `ado-${adoId(suite.planId)}-${adoId(suite.suiteId)}`, title: suite.suiteName,
    scenarios: suite.cases.map(tc => {
      requireValue(!tc.parameters && !tc.dataTable && !tc.dataTableXml, 'Parameterized ADO cases require explicit local-source refinement; legacy raw data is retained.');
      return {id: `tc-${adoId(tc.id)}`, title: tc.title, externalReferences: [{system: 'ado', id: String(tc.id)}],
        steps: tc.steps.map(step => ({action: step.action, expected: step.expected ? [step.expected] : []}))};
    })};
  return validateLocalSource(source);
}

/** Two concrete sources, no discovery registry and no ADO access for local loading. */
export async function loadTestSource(roots, selection, adoSource) {
  if (selection.kind === 'local') return loadLocalSource(roots, selection.path);
  requireValue(selection.kind === 'ado' && adoSource, 'An explicitly configured ADO source adapter is required.');
  return adoSuiteToSource(await adoSource.fetchSuite(selection.planId, selection.suiteId));
}
