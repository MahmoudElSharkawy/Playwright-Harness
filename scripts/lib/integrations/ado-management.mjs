import {createHash} from 'node:crypto';
import {assessRun, requireAssessedResult} from '../execution-core/index.mjs';
import {adoId, requireValue} from './config.mjs';

const publications = new WeakMap();
const outcomes = Object.freeze({PASS: 'Passed', FAIL: 'Failed', BLOCKED: 'Blocked', SKIPPED: 'NotExecuted', NEEDS_REVIEW: 'Blocked'});
const unique = values => new Set(values).size === values.length;
function seal(rows, provenance) {
  requireValue(rows.length > 0 && rows.length <= 500 && unique(rows.map(row => row.caseId)), 'Publication needs unique, nonempty bounded case scope.');
  const publication = Object.freeze(rows.map(row => Object.freeze({...row, outcome: outcomes[row.status], comment: row.comment ?? `Harness status=${row.status}; stability=${row.stability}; classification=${row.classification}`})));
  publications.set(publication, createHash('sha256').update(JSON.stringify(provenance)).digest('hex')); return publication;
}
/** The execution core validates evidence and decides verdicts; the adapter only maps them. */
export function prepareRunPublication(run, roots, observations, mapping) {
  const result = assessRun(run, roots, observations);
  requireValue(mapping && Object.keys(mapping).length === result.scenarios.length && result.scenarios.every(scenario => Object.hasOwn(mapping, scenario.id)), 'Publication mapping must cover exactly the validated scenario scope.');
  return seal(result.scenarios.map(scenario => ({caseId: adoId(mapping[scenario.id]), status: scenario.status, stability: scenario.stability, classification: 'validated-execution'})), {kind: 'execution-core', result, mapping});
}
/** Manual execution keeps iteration scope and every earlier validated FAIL. */
export function prepareExecutionPublication(results, scope, comments = {}) {
  results.forEach(requireAssessedResult);
  requireValue(Array.isArray(scope) && scope.length > 0 && scope.length <= 500 && unique(scope.map(item => item.id)), 'Execution publication needs unique frozen iteration scope.');
  requireValue(results.every(result => result.scenarios.every(scenario => scope.some(item => item.id === scenario.id))), 'Assessed result is outside publication scope.');
  const cases = [...new Set(scope.map(item => adoId(item.caseId)))], rows = [];
  for (const caseId of cases) {
    const iterations = scope.filter(item => adoId(item.caseId) === caseId), relevant = results.flatMap(result => result.scenarios).filter(scenario => iterations.some(item => item.id === scenario.id));
    if (!relevant.length) continue;
    const statuses = iterations.map(item => {const history = relevant.filter(scenario => scenario.id === item.id); return history.some(scenario => scenario.status === 'FAIL') ? 'FAIL' : history.at(-1)?.status ?? 'BLOCKED';});
    const status = ['FAIL', 'NEEDS_REVIEW', 'BLOCKED'].find(value => statuses.includes(value)) ?? (statuses.every(value => value === 'SKIPPED') ? 'SKIPPED' : 'PASS');
    const comment = comments[caseId]; if (comment !== undefined) requireValue(typeof comment === 'string' && comment.length <= 400 && /^[\x20-\x7e]*$/.test(comment), 'Execution comments must be at most 400 ASCII characters.');
    rows.push({caseId, status, stability: relevant.some(item => item.stability === 'unstable') ? 'unstable' : 'stable', classification: 'manual-execution', ...(comment === undefined ? {} : {comment})});
  }
  return seal(rows, {kind: 'manual-execution', results, scope, comments});
}
/** Compatibility input is explicitly a legacy verification record, not M5 evidence proof. */
export function prepareLegacyPublication(manifest, state) {
  requireValue(Array.isArray(manifest.cases) && manifest.cases.length > 0 && state?.cases && typeof state.cases === 'object', 'Legacy publication needs a manifest and completed verification records.');
  const ids = manifest.cases.map(item => adoId(item.id));
  requireValue(unique(ids) && Object.keys(state.cases).length === ids.length && Object.keys(state.cases).every(id => ids.includes(adoId(id))), 'Legacy verification scope does not match the manifest.');
  const statuses = {passed: 'PASS', failed: 'FAIL', fixme: 'FAIL', blocked: 'BLOCKED', skipped: 'SKIPPED', 'needs-review': 'NEEDS_REVIEW'};
  return seal(ids.map(caseId => {
    const item = state.cases[caseId]; requireValue(item && Object.hasOwn(statuses, item.status), 'Incomplete or unknown legacy verification status.');
    if (item.status === 'passed') requireValue(Number.isInteger(item.greens) && item.greens >= 2, 'Legacy passed cases require two scoped green runs.');
    const classification = item.classification ?? 'unclassified';
    requireValue(['app-defect', 'script-defect', 'environment', 'unclassified'].includes(classification), 'Unknown legacy failure classification.');
    return {caseId, status: statuses[item.status], stability: 'stable', classification};
  }), {kind: 'legacy-verification', manifest, state});
}

export function createAdoTestManagement(client) {
  async function workItem(id) {
    const item = await client.read(`wit/workitems/${adoId(id)}?$expand=relations&api-version=7.1`);
    requireValue(adoId(item.id) === adoId(id) && Number.isInteger(item.rev) && item.rev > 0 && item.fields, 'ADO work item identity/revision is incomplete.');
    await client.requireWorkItemProject(item);
    return item;
  }
  async function patchItem(delivery, item, ops, verify) {
    const id = adoId(item.id);
    delivery.identified({workItemId: id});
    await delivery.write('update-work-item', `wit/workitems/${id}?api-version=7.1`, [{op: 'test', path: '/rev', value: item.rev}, ...ops], {patch: true});
    const after = await workItem(id); requireValue(after.rev > item.rev && verify(after), 'Work-item readback did not verify the requested update.');
    delivery.verified({workItemId: id});
  }
  async function updateItems(kind, ids, execute, prepare) {
    ids = ids.map(adoId); requireValue(ids.length > 0 && ids.length <= 500 && unique(ids), 'Work item scope must be nonempty, unique and bounded.');
    const updates = [];
    // All preparatory reads happen before the first write; revision tests protect the gap.
    for (const id of ids) { const item = await workItem(id); updates.push({item, ...await prepare(item)}); }
    const summary = {mode: 'dry-run', selected: ids.length, changes: updates.filter(row => row.ops.length).length};
    if (!execute || !summary.changes) return {...summary, mode: execute ? 'no-op' : 'dry-run'};
    const delivery = client.delivery(kind, execute);
    try {
      for (const update of updates) if (update.ops.length) await patchItem(delivery, update.item, update.ops, update.verify);
      return {...summary, ...delivery.finish()};
    } catch { throw delivery.incomplete(); }
  }
  return Object.freeze({
    async publish({publication, planId, suiteId, pointIds = {}, execute = false, name, resumeRunId, onIdentity, onReceipt}) {
      requireValue(publications.has(publication), 'Use a validated publication input.'); planId = adoId(planId); suiteId = adoId(suiteId);
      requireValue(Object.keys(pointIds).every(id => publication.some(row => row.caseId === adoId(id))), 'Point selections contain cases outside publication scope.');
      const points = await client.list(`test/Plans/${planId}/Suites/${suiteId}/points?api-version=7.1`, 'offset');
      requireValue(unique(points.map(point => adoId(point.id))), 'ADO returned duplicate points.');
      const rows = publication.map(row => {
        const candidates = points.filter(point => adoId(point.testCase?.id) === row.caseId);
        const selected = Object.hasOwn(pointIds, row.caseId) ? candidates.filter(point => adoId(point.id) === adoId(pointIds[row.caseId])) : candidates;
        requireValue(selected.length === 1, 'Missing or ambiguous ADO test point; configure an explicit point ID per case.');
        return {...row, pointId: adoId(selected[0].id)};
      });
      requireValue(name === undefined || typeof name === 'string' && name.trim() && name.length <= 256 && !/[\r\n\0]/.test(name), 'Invalid ADO run name.');
      if (!execute) return {mode: 'dry-run', cases: rows.map(({caseId, pointId, outcome}) => ({caseId, pointId, outcome}))};
      const delivery = client.delivery('outcomes', execute, publications.get(publication)); let runId, adoptedCompleted = false;
      await onReceipt?.(delivery.receipt);
      delivery.identified({planId, suiteId});
      async function results() {
        const values = await client.list(`test/runs/${runId}/results?api-version=7.1`, 'offset');
        requireValue(values.length === rows.length && unique(values.map(value => adoId(value.id))) && unique(values.map(value => adoId(value.testPoint?.id))), 'ADO result scope is incomplete or duplicated.');
        requireValue(rows.every(row => values.some(value => adoId(value.testPoint?.id) === row.pointId)), 'ADO result-to-point association mismatch.');
        requireValue(values.every(value => value.testRun === undefined || adoId(value.testRun.id) === runId), 'ADO result belongs to another run.');
        requireValue(values.every(value => value.testCase === undefined || rows.some(row => row.pointId === adoId(value.testPoint.id) && row.caseId === adoId(value.testCase.id))), 'ADO result belongs to another case.');
        return values;
      }
      try {
        if (resumeRunId !== undefined) {
          runId = adoId(resumeRunId); const adopted = await client.read(`test/runs/${runId}?api-version=7.1`);
          requireValue(adoId(adopted.id) === runId && adoId(adopted.plan?.id) === planId && adopted.name === name && adopted.isAutomated !== true && adopted.automated !== true, 'Adopted ADO run does not match the frozen publication identity.');
          adoptedCompleted = adopted.state === 'Completed';
        } else {
          const run = await delivery.write('create-run', 'test/runs?api-version=7.1', {name: name ?? `Harness delivery ${delivery.id}`, plan: {id: String(planId)}, pointIds: rows.map(row => row.pointId), automated: false}, {method: 'POST', onIdentity});
          runId = adoId(run.id);
        }
        delivery.identified({runId}); await onIdentity?.({runId});
        const before = await results();
        const body = rows.map(row => ({id: adoId(before.find(value => adoId(value.testPoint.id) === row.pointId).id), outcome: row.outcome, state: 'Completed', comment: row.comment}));
        const pointByResult = new Map(before.map(value => [adoId(value.id), adoId(value.testPoint.id)]));
        function verifyResults(after) {
          requireValue(body.every(expected => after.some(actual => adoId(actual.id) === expected.id && adoId(actual.testPoint.id) === pointByResult.get(expected.id) && actual.outcome === expected.outcome && actual.state === expected.state && actual.comment === expected.comment)), 'Published result readback or identity association mismatch.');
        }
        if (adoptedCompleted) {verifyResults(before); delivery.verified({runId, resultCount: body.length}); return {...delivery.finish(), runId, count: rows.length};}
        await delivery.write('update-results', `test/runs/${runId}/results?api-version=7.1`, body);
        verifyResults(await results());
        delivery.verified({runId, resultCount: body.length});
        await delivery.write('complete-run', `test/runs/${runId}?api-version=7.1`, {state: 'Completed'});
        const complete = await client.read(`test/runs/${runId}?api-version=7.1`);
        requireValue(adoId(complete.id) === runId && complete.state === 'Completed', 'ADO run completion did not verify.');
        verifyResults(await results());
        delivery.verified({runId}); return {...delivery.finish(), runId, count: rows.length};
      } catch { throw delivery.incomplete(); }
    },
    async tag({ids, tag, execute = false}) {
      requireValue(typeof tag === 'string' && tag.trim() === tag && tag.length > 0 && tag.length <= 100 && !/[;\r\n]/.test(tag), 'Supply one nonempty bounded tag.');
      return updateItems('tags', ids, execute, item => {
        const tags = String(item.fields['System.Tags'] ?? '').split(';').map(value => value.trim()).filter(Boolean);
        return {ops: tags.includes(tag) ? [] : [{op: 'add', path: '/fields/System.Tags', value: [...tags, tag].join('; ')}],
          verify: after => [...tags, tag].every(value => String(after.fields['System.Tags'] ?? '').split(';').map(part => part.trim()).includes(value))};
      });
    },
    async relink({ids, storyId, execute = false}) {
      storyId = adoId(storyId); const story = await workItem(storyId);
      const project = await client.projectIdentity();
      const allowed = [`${client.configuration.organizationUrl}/_apis/wit/workitems/${storyId}`, ...[project.id, project.name].map(value => `${client.configuration.organizationUrl}/${encodeURIComponent(value)}/_apis/wit/workitems/${storyId}`)].map(value => value.toLowerCase());
      const matches = relation => typeof relation.url === 'string' && allowed.includes(relation.url.replace(/\/$/, '').toLowerCase());
      requireValue(story.id === storyId, 'ADO story scope mismatch.');
      return updateItems('relations', ids, execute, item => {
        const relations = item.relations ?? [], parents = relations.map((relation, index) => ({relation, index})).filter(({relation}) => matches(relation) && relation.rel === 'System.LinkTypes.Hierarchy-Reverse');
        const related = relations.some(relation => matches(relation) && relation.rel === 'System.LinkTypes.Related');
        requireValue(parents.length || related, 'No matching story relation in the configured collection.');
        const ops = parents.reverse().map(({index}) => ({op: 'remove', path: `/relations/${index}`}));
        if (!related) ops.push({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${storyId}`}});
        const untouched = relations.filter(relation => !(matches(relation) && relation.rel === 'System.LinkTypes.Hierarchy-Reverse'));
        return {ops, verify: after => (after.relations ?? []).some(relation => matches(relation) && relation.rel === 'System.LinkTypes.Related')
          && !(after.relations ?? []).some(relation => matches(relation) && relation.rel === 'System.LinkTypes.Hierarchy-Reverse')
          && untouched.every(relation => (after.relations ?? []).some(value => value.rel === relation.rel && value.url === relation.url))};
      });
    },
    async markAutomation({publication, tests, value = 'Automated', execute = false}) {
      requireValue(publications.has(publication) && ['Automated', 'Not Automated'].includes(value), 'Automation marking requires validated input and a supported value.');
      const eligible = publication.filter(row => value !== 'Automated' || row.status === 'PASS' || (row.status === 'FAIL' && row.classification === 'app-defect'));
      const byId = new Map(eligible.map(row => [row.caseId, tests?.[row.caseId]]));
      return updateItems('automation', eligible.map(row => row.caseId), execute, item => {
        const gen = byId.get(item.id), prefix = 'Microsoft.VSTS.TCM.';
        if (value === 'Automated') requireValue(gen && typeof gen.title === 'string' && gen.title.trim() && typeof gen.file === 'string' && gen.file.length <= 1024 && gen.file.endsWith('.spec.ts') && !/[\\\x00-\x1f]/.test(gen.file) && !/^[A-Za-z]:/.test(gen.file) && gen.file.split('/').every(part => part && !['.', '..'].includes(part)), 'Automation marking needs an unambiguous generated test pointer.');
        const hash = value === 'Automated' ? createHash('sha1').update(`${gen.file}::${gen.title}`).digest('hex') : '';
        const testId = hash ? [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-') : '';
        const fields = {[`${prefix}AutomationStatus`]: value, [`${prefix}AutomatedTestName`]: gen && value === 'Automated' ? gen.title : '', [`${prefix}AutomatedTestStorage`]: gen && value === 'Automated' ? gen.file : '', [`${prefix}AutomatedTestId`]: testId, [`${prefix}AutomatedTestType`]: value === 'Automated' ? 'Playwright' : ''};
        if (client.configuration.automationField) fields[client.configuration.automationField] = value;
        return {ops: Object.entries(fields).filter(([key, expected]) => item.fields[key] !== expected).map(([key, expected]) => ({op: 'add', path: `/fields/${key}`, value: expected})), verify: after => Object.entries(fields).every(([key, expected]) => after.fields[key] === expected)};
      });
    }
  });
}
