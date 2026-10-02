import {parseStepsXml, htmlToText} from './ado-steps.mjs';
import {adoId, requireValue, workItemLinkId} from './config.mjs';
import {validateLocalSource, loadLocalSource} from '../local-source.mjs';
import {emptyAdoMetadata} from './ado-metadata.mjs';

const fields = ['System.Id', 'System.Title', 'System.TeamProject', 'System.State', 'System.Tags', 'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.TCM.Steps', 'Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource'];
// Story relation selections in canonical order; Tested By is the requirement-to-test link.
const storyLinks = Object.freeze({'tested-by': 'Microsoft.VSTS.Common.TestedBy-Forward', child: 'System.LinkTypes.Hierarchy-Forward', related: 'System.LinkTypes.Related'});
const discovery = ['System.Id', 'System.WorkItemType', 'System.TeamProject'];

export function createAdoTestSource(client) {
  async function batch(ids, select = fields, owned = true) {
    const items = new Map();
    for (let start = 0; start < ids.length; start += 200) {
      const scope = ids.slice(start, start + 200), response = await client.workItems(scope, select);
      requireValue(Array.isArray(response.value) && response.value.length === scope.length, 'ADO omitted required work items.');
      for (const item of response.value) {
        const id = adoId(item.id); requireValue(scope.includes(id) && !items.has(id) && item.fields, 'ADO work-item scope mismatch.');
        if (owned) await client.requireWorkItemProject(item);
        items.set(id, item);
      }
    }
    return items;
  }
  async function readCases(ids) {
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
          requireValue(emptyAdoMetadata(item.fields['Microsoft.VSTS.TCM.Parameters'], 'parameters') && emptyAdoMetadata(item.fields['Microsoft.VSTS.TCM.LocalDataSource'], 'NewDataSet'), 'Parameterized shared steps require explicit refinement.');
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
      const dataTableXml = f['Microsoft.VSTS.TCM.LocalDataSource'] ?? null;
      const dataTable = typeof dataTableXml === 'string' && !emptyAdoMetadata(dataTableXml, 'NewDataSet') ? [...dataTableXml.matchAll(/<Table1>([\s\S]*?)<\/Table1>/g)].map(row => Object.fromEntries([...row[1].matchAll(/<([^>\/\s]+)>([\s\S]*?)<\/\1>/g)].map(cell => [cell[1], htmlToText(cell[2])]))) : null;
      cases.push({id, title: f['System.Title'], state: f['System.State'] ?? '', priority: f['Microsoft.VSTS.Common.Priority'] ?? null,
        tags: String(f['System.Tags'] ?? '').split(';').map(tag => tag.trim()).filter(Boolean), steps: await expand(f['Microsoft.VSTS.TCM.Steps']),
        parameters: f['Microsoft.VSTS.TCM.Parameters'] ?? null, dataTable, ...(dataTableXml === null ? {} : {dataTableXml})});
    }
    return cases;
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
      const cases = await readCases(ids);
      return {planId, suiteId, suiteName: metadata.name, organizationUrl: client.configuration.organizationUrl, project: client.configuration.project, cases};
    },
    async fetchStory(story, links = ['tested-by']) {
      const storyId = adoId(story);
      requireValue(Array.isArray(links) && links.length > 0 && new Set(links).size === links.length && links.every(name => Object.hasOwn(storyLinks, name)), 'Story links must be distinct tested-by, child or related selections.');
      const selected = Object.keys(storyLinks).filter(name => links.includes(name)), relations = selected.map(name => storyLinks[name]);
      const item = await client.read(`wit/workitems/${storyId}?$expand=relations&api-version=7.1`);
      requireValue(adoId(item.id) === storyId && Number.isInteger(item.rev) && item.rev > 0 && item.fields && (item.relations === undefined || Array.isArray(item.relations)), 'ADO story identity/revision is incomplete.');
      await client.requireWorkItemProject(item);
      requireValue(typeof item.fields['System.Title'] === 'string' && item.fields['System.Title'].trim(), 'ADO story title is missing.');
      // The process defines its test-case types, so custom and localized processes need no assumed name.
      const category = await client.read('wit/workitemtypecategories/Microsoft.TestCaseCategory?api-version=7.1'), kinds = category.workItemTypes;
      requireValue(String(category.referenceName).toLowerCase() === 'microsoft.testcasecategory' && Array.isArray(kinds) && kinds.length > 0 && kinds.length <= 100 && kinds.every(kind => typeof kind?.name === 'string' && kind.name.trim()), 'ADO test-case category is unavailable or incomplete.');
      const testCase = type => typeof type === 'string' && kinds.some(kind => kind.name.toLowerCase() === type.toLowerCase());
      requireValue(!testCase(item.fields['System.WorkItemType']), 'ADO story ID names a test case; supply the user story ID.');
      const identity = await client.projectIdentity(), linked = new Set();
      for (const relation of item.relations ?? []) if (relations.includes(relation?.rel)) {
        const id = workItemLinkId(relation.url, client.configuration.organizationUrl, identity);
        requireValue(id !== undefined, 'ADO story link is outside the configured collection or project.'); linked.add(id);
      }
      const candidates = [...linked].sort((a, b) => a - b);
      requireValue(candidates.length <= 1000, 'ADO story links exceed the bounded scope.');
      // Classify before reading content: excluded items are reported by ID only, never ingested.
      const found = await batch(candidates, discovery, false), ids = [], excluded = [];
      for (const id of candidates) {
        const f = found.get(id).fields;
        requireValue(typeof f['System.WorkItemType'] === 'string' && typeof f['System.TeamProject'] === 'string', 'ADO linked work-item classification is incomplete.');
        if (!testCase(f['System.WorkItemType'])) excluded.push({id, reason: 'not-test-case'});
        else if (f['System.TeamProject'].toLowerCase() !== identity.name.toLowerCase()) excluded.push({id, reason: 'other-project'});
        else ids.push(id);
      }
      requireValue(ids.length > 0, 'ADO story has no linked test cases for the selected link types.');
      requireValue(ids.length <= 500, 'ADO story needs 1–500 linked test cases.');
      return {storyId, storyTitle: item.fields['System.Title'], links: selected, organizationUrl: client.configuration.organizationUrl, project: client.configuration.project, cases: await readCases(ids), excluded};
    }
  });
}

/** Explicit refinement is required where the neutral v1 source cannot preserve parameter semantics. */
function neutralSource(id, title, cases) {
  const source = {version: 1, id, title,
    scenarios: cases.map(tc => {
      requireValue(emptyAdoMetadata(tc.parameters, 'parameters') && emptyAdoMetadata(tc.dataTable, 'NewDataSet') && emptyAdoMetadata(tc.dataTableXml, 'NewDataSet'), 'Parameterized ADO cases require explicit local-source refinement; legacy raw data is retained.');
      return {id: `tc-${adoId(tc.id)}`, title: tc.title, externalReferences: [{system: 'ado', id: String(tc.id)}],
        steps: tc.steps.map(step => ({action: step.action, expected: step.expected ? [step.expected] : []}))};
    })};
  return validateLocalSource(source);
}
export function adoSuiteToSource(suite) { return neutralSource(`ado-${adoId(suite.planId)}-${adoId(suite.suiteId)}`, suite.suiteName, suite.cases); }
export function adoStoryToSource(story) { return neutralSource(`ado-story-${adoId(story.storyId)}`, story.storyTitle, story.cases); }

/** Two concrete sources, no discovery registry and no ADO access for local loading. */
export async function loadTestSource(roots, selection, adoSource) {
  if (selection.kind === 'local') return loadLocalSource(roots, selection.path);
  requireValue(selection.kind === 'ado' && adoSource, 'An explicitly configured ADO source adapter is required.');
  if (selection.storyId === undefined) return adoSuiteToSource(await adoSource.fetchSuite(selection.planId, selection.suiteId));
  requireValue(selection.planId === undefined && selection.suiteId === undefined, 'Choose an ADO suite or story selection, not both.');
  return adoStoryToSource(await adoSource.fetchStory(selection.storyId, selection.links));
}
