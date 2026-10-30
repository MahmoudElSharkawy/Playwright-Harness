import {retainAssessment} from './design-review.mjs';
import {adoFixture} from './ado.mjs';
import {prepareDesign, saveDesign, assessDesign} from '../../scripts/lib/test-case-design/index.mjs';
import {updateInventory} from '../../scripts/lib/requirements/index.mjs';
import {editStepsXml} from '../../scripts/lib/integrations/ado-step-edit.mjs';

export async function adoDesignFixture(t, overrides = {}, {existingFields = {}} = {}) {
  const f = await adoFixture(t, overrides), fields = ['System.Title', 'System.Description', 'System.Tags', 'System.History', 'Microsoft.VSTS.TCM.Steps'];
  const history = new Map(), control = {loseCreate: false, loseUpdate: false, denyField: null, rejectWrite: false, denyTags: false, discussion: [], writes: 0, afterWrite: null, storyUpdates: []};
  control.fields = fields.map(referenceName => ({referenceName, name: referenceName, type: referenceName === 'System.Description' || referenceName.endsWith('.Steps') ? 'html' : referenceName === 'System.History' ? 'history' : 'string', readOnly: false, alwaysRequired: referenceName === 'System.Title'}));
  control.fields.push(...['Area', 'Iteration'].flatMap(name => [{referenceName: `System.${name}Id`, name: `${name} ID`, type: 'integer', readOnly: true, alwaysRequired: true}, {referenceName: `System.${name}Path`, name: `${name} Path`, type: 'treePath', readOnly: false, defaultValue: 'demo'}]));
  control.validations = []; control.normalizations = {}; control.serverDefaults = {}; control.beforeWrite = null; control.validPaths = ['demo', 'demo\\Catalog', 'demo\\Sprint 1'];
  const story = f.state.items.get(200); story.fields = {'System.Title': 'Sign in', 'System.WorkItemType': 'User Story', 'System.TeamProject': 'demo', 'System.Description': '', 'Microsoft.VSTS.Common.AcceptanceCriteria': 'A valid login opens the current user dashboard.'}; story.relations = [];
  const existing = f.state.items.get(101); existing.fields['System.WorkItemType'] = 'Test Case'; existing.fields['System.Description'] = '<p>Keep unrelated content.</p>'; existing.fields['System.Tags'] = 'team-owned; Functional; Positive'; existing.fields['Microsoft.VSTS.TCM.Steps'] = editStepsXml('<steps id="0" last="0"></steps>', {}, [{id: 1, action: {text: 'Open sign-in'}, expected: {text: 'Sign-in is visible.'}}]);
  Object.assign(existing.fields, existingFields);
  history.set(101, [structuredClone(existing)]); history.set(200, [structuredClone(story)]);
  f.state.fault = ({path, req, res, body, send, url}) => {
    if (path === 'wit/workitemtypecategories/microsoft.testcasecategory') {send({referenceName: 'Microsoft.TestCaseCategory', defaultWorkItemType: {name: 'Test Case'}, workItemTypes: [{name: 'Test Case'}]}); return true;}
    if (path === 'wit/workitemtypes/test%20case/fields') {send({value: control.fields.filter(field => field.referenceName !== control.denyField).map(({readOnly, ...field}) => field)}); return true;}
    if (path === 'wit/fields') {send({value: control.fields.map(field => ({...field, readOnly: field.readOnly || field.referenceName === control.denyField, isLocked: false}))}); return true;}
    if (path === 'wit/tags') {send({value: [{name: 'team-owned'}, {name: 'Functional'}, {name: 'Positive'}]}, control.denyTags ? 403 : 200); return true;}
    if (path === 'wit/workitems/200/comments') {send({comments: control.discussion, totalCount: control.discussion.length}); return true;}
    if (path === 'wit/workitems/200/updates') {send({value: control.storyUpdates.slice(Number(url.searchParams.get('$skip') ?? 0), Number(url.searchParams.get('$skip') ?? 0) + 100)}); return true;}
    const revisions = /^wit\/workitems\/(\d+)\/revisions(?:\/(\d+))?$/.exec(path);
    if (revisions) {const entries = history.get(Number(revisions[1])) ?? []; send(revisions[2] ? entries.find(item => item.rev === Number(revisions[2])) ?? {} : {value: entries.slice(Number(url.searchParams.get('$skip') ?? 0), Number(url.searchParams.get('$skip') ?? 0) + Number(url.searchParams.get('$top') ?? 100))}); return true;}
    const create = path === 'wit/workitems/$test%20case', update = /^wit\/workitems\/(\d+)$/.exec(path);
    if (create && req.method === 'POST' || update && req.method === 'PATCH') {
      const old = update && f.state.items.get(Number(update[1]));
      if (update && (!old || body[0]?.path !== '/rev' || body[0]?.value !== old.rev)) {send({}, 412); return true;}
      if (control.rejectWrite) {send({}, 403); return true;}
      if (url.searchParams.get('validateOnly') !== 'true') control.beforeWrite?.();
      const item = old ? structuredClone(old) : {id: f.state.nextBug, rev: 0, fields: {'System.WorkItemType': 'Test Case', 'System.TeamProject': 'demo'}, relations: []};
      if (!old) for (const field of control.fields) if (!field.readOnly && field.defaultValue !== undefined) item.fields[field.referenceName] = field.defaultValue;
      if (!old) Object.assign(item.fields, control.serverDefaults);
      for (const operation of body) if (operation.path.startsWith('/fields/')) item.fields[operation.path.slice(8)] = operation.value; else if (operation.path === '/relations/-') item.relations.push(operation.value);
      for (const field of control.fields) {
        const value = item.fields[field.referenceName];
        if (!field.readOnly && field.alwaysRequired && (value === undefined || value === null || value === '' && !field.allowedValues?.includes(''))) {send({}, 422); return true;}
        if (['System.AreaPath', 'System.IterationPath'].includes(field.referenceName) && value !== undefined && !control.validPaths.some(path => path.toLowerCase() === String(value).toLowerCase())) {send({}, 422); return true;}
        if (value !== undefined && control.normalizations[field.referenceName]) item.fields[field.referenceName] = control.normalizations[field.referenceName](value);
      }
      item.fields['System.AreaId'] = 1; item.fields['System.IterationId'] = 2;
      item.rev++;
      if (url.searchParams.get('validateOnly') === 'true') {control.validations.push(structuredClone(body)); send(item); return true;}
      if (create) f.state.nextBug++;
      f.state.items.set(item.id, item); history.set(item.id, [...(history.get(item.id) ?? []), structuredClone(item)]); control.writes++;
      if (create) {
        const relation = {rel: 'Microsoft.VSTS.Common.TestedBy-Forward', url: `${f.config.organizationUrl}/_apis/wit/workitems/${item.id}`}; story.relations.push(relation); story.rev++;
        history.set(200, [...history.get(200), structuredClone(story)]); control.storyUpdates.push({workItemId: 200, rev: story.rev, fields: {'System.Rev': {oldValue: story.rev - 1, newValue: story.rev}}, relations: {added: [relation]}});
      }
      control.afterWrite?.(item);
      if (create && control.loseCreate || update && control.loseUpdate) res.destroy(); else send(item); return true;
    }
  };
  let state = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', request: {version: 1, project: 'demo', application: 'login', storyId: 200, sources: []}, caseIds: [101]}, {client: f.client});
  const entry = state.requirements.inventory.find(row => row.kind === 'criterion'), part = state.evidence.requirements.parts.find(row => row.id === entry.partId);
  updateInventory(f.roots, 'login', {version: 1, snapshot: state.requirements.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'source', partId: part.id, revision: part.revision, quote: part.text}]}]});
  state = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  const proposal = {version: 1, author: 'designer', source: state.source, cases: ['NEW-01', '101'].map(id => ({id, proposedAction: id.startsWith('NEW-') ? 'Create' : 'Update', title: id.startsWith('NEW-') ? 'Sign in with valid credentials' : 'Verify correct account identity', prerequisites: 'A dedicated active account exists; user is signed out.', testData: 'Account username and env:TEST_PASSWORD.', coverageReferences: [{requirementId: entry.id, label: 'AC-1: Successful sign-in'}], testType: 'Functional', scenarioType: 'Positive', steps: [{action: 'Open sign-in and enter valid credentials.', expected: 'The current user dashboard displays the correct account identity.'}]})), mappings: ['NEW-01', '101'].map(caseId => ({caseId, requirementId: entry.id, checks: [{step: 1, expected: 'The current user dashboard displays the correct account identity.', data: 'Account username and env:TEST_PASSWORD.'}]})), preparations: ['NEW-01', '101'].map(caseId => ({caseId, expected: 'The dedicated account is active, credentials are available and no session exists.'}))};
  state = saveDesign(f.roots, 'login', proposal);
  state = assessDesign(f.roots, 'login', retainAssessment(f.roots, state, {version: 1, proposal: state.proposal, reviewer: 'reviewer', cases: proposal.cases.map(row => ({id: row.id, verdict: 'pass', reason: 'The step checks the correct account identity.'})), requirements: state.requirements.inventory.filter(row => ['requirement', 'criterion'].includes(row.kind)).map(row => ({id: row.id, verdict: row.id === entry.id ? 'covered' : 'unresolved', reason: 'The accepted sign-in outcome is verified.', caseIds: row.id === entry.id ? ['NEW-01', '101'] : []}))}));
  return {...f, control, history, design: state, proposal};
}
