import {data, fingerprint, requireThat} from '../execution-core/data.mjs';
import {jiraIssueKey} from './jira-config.mjs';
import {nativeFieldValues, sameFieldValue, validateFieldMetadata, validateNativeFields} from './native-fields.mjs';
import {capabilities, desiredCase, verifiedContent, automationIdentity, mappedStatus, validateResults, nativeRequest, writeRequest, testManagementDelivery} from './test-management-common.mjs';

const PROPERTY = 'pom-harness.automation', AUTOMATED_LABEL = 'pom-harness-automated';
const TEST_FIELDS = 'issueId projectId jira(fields:["key","project"]) lastModified testType { name } dataset { id } steps { id action data result libStepId callTestIssueId attachments { id } customFields { id value } } preconditions(limit:100) { total results { issueId projectId definition lastModified preconditionType { name } } }';
const RUN_FIELDS = 'id lastModified comment status { name } test { issueId } testExecution { issueId } parameters { name value } steps { id action data result actualResult status { name } }';
const mutation = (operation, query, variables) => nativeRequest(operation, 'graphql', 'POST', {query, variables});
const ownedFields = ['project', 'issuetype', 'summary', 'labels', 'issuelinks', 'attachment', 'status'];
const fieldId = value => typeof value === 'string' && /^(?:[a-z][a-zA-Z0-9]*|customfield_[1-9]\d*)$/.test(value);
const typeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const trackedField = name => name.startsWith('customfield_') || ['issuetype', 'description', 'priority', 'resolution', 'assignee', 'reporter', 'components', 'fixVersions', 'versions', 'duedate', 'environment', 'security', 'timetracking', 'timeoriginalestimate', 'timeestimate', 'parent'].includes(name);
const trackedFields = fields => Object.fromEntries(Object.entries(fields).filter(([name]) => trackedField(name)));
const readableField = name => trackedField(name) || ['project', 'summary', 'labels', 'updated', 'issuelinks'].includes(name);

export function createXrayAdapter({jira, transport, roots}) {
  const provider = 'xray', config = jira.configuration;
  function key(value) {requireThat(jiraIssueKey(value) && value.startsWith(config.project + '-'), 'Xray issue key must belong to the selected project.'); return value;}
  async function requireNativeSite(value, issue) {
    const project = await jira.projectIdentity(), native = value?.jira, nativeProject = native?.project;
    requireThat(value?.issueId === String(issue.id) && native?.key === issue.key && nativeProject?.key === project.key && String(nativeProject?.id) === String(project.id), 'Xray native Jira issue/project identity differs from the selected source.');
    let self; try {self = new URL(nativeProject.self);} catch {throw new Error('Xray native Jira project site is missing.');}
    requireThat(self.origin === config.siteUrl && !self.username && !self.password && !self.search && !self.hash && [`/rest/api/2/project/${project.id}`, `/rest/api/3/project/${project.id}`].includes(self.pathname), 'Xray credentials belong to another Jira site or project.');
  }
  async function nativeStory(storyKey) {
    const issue = await jira.issue(key(storyKey));
    const value = (await transport.query('query($id:String!) { getCoverableIssue(issueId:$id) { issueId jira(fields:["key","project"]) } }', {id: String(issue.id)})).getCoverableIssue;
    await requireNativeSite(value, issue); return issue;
  }
  async function readCase(id) {
    key(id); const issue = await jira.issue(id), project = await jira.projectIdentity();
    const raw = (await transport.query(`query($id:String!) { getTest(issueId:$id) { ${TEST_FIELDS} } }`, {id: String(issue.id)})).getTest;
    await requireNativeSite(raw, issue);
    requireThat(raw && raw.issueId === String(issue.id) && raw.projectId === project.id && typeof raw.lastModified === 'string', 'Xray test identity/project/version is incomplete.');
    requireThat(raw.testType?.name === 'Manual' && !raw.dataset && Array.isArray(raw.steps) && raw.steps.length > 0 && raw.steps.length <= 500, 'Xray non-manual, empty or dataset tests require native review; unsupported source cannot be flattened.');
    const steps = raw.steps.map(step => {
      requireThat(typeof step.id === 'string' && step.id && typeof step.action === 'string' && typeof step.result === 'string' && !step.libStepId && !step.callTestIssueId && !(step.attachments?.length) && !(step.customFields?.length), 'Xray called, library, custom or attached steps are unsupported; preserve them for native review.');
      return {id: step.id, action: step.action, data: step.data ?? '', expected: step.result};
    });
    requireThat(raw.preconditions && Array.isArray(raw.preconditions.results) && raw.preconditions.results.length === raw.preconditions.total && raw.preconditions.total <= 100, 'Xray preconditions are incomplete or exceed their bound.');
    const preconditions = raw.preconditions.results.map(item => {
      requireThat(item.projectId === project.id && item.preconditionType?.name === 'Manual' && typeof item.definition === 'string' && typeof item.lastModified === 'string', 'Unsupported Xray precondition definition.');
      return {id: String(item.issueId), text: item.definition, revision: item.lastModified};
    });
    const stableIssue = {id: issue.id, key: issue.key, project: issue.fields.project ?? null, summary: issue.fields.summary, description: issue.fields.description ?? null, updated: issue.fields.updated ?? null, labels: issue.fields.labels ?? [], nativeFields: trackedFields(issue.fields),
      links: (issue.fields.issuelinks ?? []).map(link => ({id: link.id, type: link.type?.id ?? null, inward: link.inwardIssue?.key ?? null, outward: link.outwardIssue?.key ?? null}))};
    const retained = data({test: raw, issue: {id: issue.id, key: issue.key, fields: {...stableIssue.nativeFields, project: stableIssue.project, summary: stableIssue.summary, description: stableIssue.description, updated: stableIssue.updated, labels: stableIssue.labels,
      issuelinks: stableIssue.links.map(link => ({id: link.id, type: {id: link.type}, ...(link.inward ? {inwardIssue: {key: link.inward}} : {}), ...(link.outward ? {outwardIssue: {key: link.outward}} : {})}))}}}, 2 * 1024 * 1024);
    return {provider, siteUrl: config.siteUrl, project: config.project, id, nativeId: raw.issueId, revision: raw.lastModified, fingerprint: fingerprint({test: raw, issue: stableIssue}), title: issue.fields.summary, steps, preconditions, labels: issue.fields.labels ?? [],
      externalReferences: [{system: provider, id: `${config.siteUrl}/browse/${id}`}], raw: retained};
  }
  async function selectedCases(field, groupKey) {
    key(groupKey); const issue = await jira.issue(groupKey), ids = [], seen = new Set(); let start = 0;
    for (let page = 0; page < 100; page++) {
      const result = (await transport.query(`query($id:String!,$start:Int!) { ${field}(issueId:$id) { issueId jira(fields:["key","project"]) tests(limit:100,start:$start) { total start results { issueId jira(fields:["key"]) } } } }`, {id: String(issue.id), start}))[field];
      await requireNativeSite(result, issue);
      requireThat(result?.issueId === String(issue.id) && result.tests && Array.isArray(result.tests.results) && result.tests.start === start && Number.isSafeInteger(result.tests.total) && result.tests.total <= 500, 'Xray selection is incomplete or exceeds 500 cases.');
      for (const row of result.tests.results) {const id = key(row.jira?.key); requireThat(!seen.has(id), 'Xray case selection contains duplicates.'); seen.add(id); ids.push(id);}
      requireThat(ids.length <= result.tests.total, 'Xray selection total is incomplete.'); if (ids.length === result.tests.total) break;
      requireThat(result.tests.results.length > 0, 'Xray pagination did not advance.'); start += result.tests.results.length;
      requireThat(page < 99, 'Xray selection exceeds the page bound.');
    }
    const cases = []; for (const id of ids) cases.push(await readCase(id)); return cases;
  }
  const storyCases = id => selectedCases('getCoverableIssue', id);
  const groupCases = ({kind, id}) => {const field = {'test-set': 'getTestSet', plan: 'getTestPlan', execution: 'getTestExecution'}[kind]; requireThat(field, 'Select an Xray test-set, plan or execution.'); return selectedCases(field, id);};
  async function storyLink(storyKey, selectedId) {
    const issue = await nativeStory(storyKey), definitions = await jira.read('issueLinkType');
    requireThat(Array.isArray(definitions.issueLinkTypes), 'Jira test coverage link metadata is incomplete.');
    const matching = definitions.issueLinkTypes.filter(type => selectedId ? String(type.id) === String(selectedId) : type.outward?.toLowerCase() === 'tests' && type.inward?.toLowerCase() === 'is tested by');
    requireThat(matching.length === 1, 'Select the native Xray Tests issue-link type from current Jira metadata.');
    return {storyKey: issue.key, storyId: String(issue.id), linkType: String(matching[0].id)};
  }
  async function testIssueType() {
    const types = new Set(), seen = new Set(); let start = 0, total;
    for (let page = 0; page < 5; page++) {
      const result = (await transport.query('query($jql:String!,$start:Int!) { getTests(jql:$jql,limit:100,start:$start) { total start results { issueId jira(fields:["key","project","issuetype"]) } } }', {jql: `project = "${config.project}"`, start})).getTests;
      requireThat(result && Array.isArray(result.results) && result.results.length <= 100 && result.start === start && Number.isSafeInteger(result.total) && result.total >= 0 && result.total <= 500 && (total === undefined || total === result.total), 'Xray Test issue-type discovery is incomplete or exceeds 500 cases.');
      total = result.total;
      for (const row of result.results) {
        const id = key(row.jira?.key); requireThat(typeId(row.issueId) && typeId(row.jira?.issuetype?.id) && !seen.has(id), 'Xray native Test issue-type identity is incomplete or duplicated.');
        await requireNativeSite(row, {id: row.issueId, key: id}); seen.add(id); types.add(row.jira.issuetype.id);
      }
      requireThat(types.size <= 1, 'Xray native Test issue types are ambiguous; select the native project configuration before continuing.');
      start += result.results.length; requireThat(start <= total, 'Xray Test issue-type discovery total is inconsistent.');
      if (start === total) break;
      requireThat(result.results.length > 0 && page < 4, 'Xray Test issue-type discovery did not complete.');
    }
    const configured = config.testManagement.testIssueTypeId, discovered = [...types][0];
    requireThat(!configured || typeId(configured), 'Configured Xray testIssueTypeId is invalid.');
    requireThat(!configured || !discovered || configured === discovered, 'Configured Xray issue type differs from the discovered native Test type.');
    requireThat(discovered || configured, 'The project has no existing Xray Test to identify its issue type; configure testIssueTypeId explicitly.');
    return discovered ?? configured;
  }
  async function caseMetadata(before) {
    const creating = !before, project = await jira.projectIdentity(); let issueTypeId, fields;
    if (creating) {
      issueTypeId = await testIssueType();
      const types = await jira.list(`issue/createmeta/${project.key}/issuetypes`, {itemsKey: 'issueTypes'}), matches = types.filter(type => type.id === issueTypeId && type.subtask !== true);
      requireThat(matches.length === 1, 'The native Xray Test issue type is unavailable in current Jira create metadata.');
      fields = await jira.list(`issue/createmeta/${project.key}/issuetypes/${issueTypeId}`, {itemsKey: 'fields', maxItems: 1000});
    } else {
      issueTypeId = before.raw.issue.fields.issuetype?.id;
      requireThat(typeId(issueTypeId), 'The existing Xray Test issue type is missing from Jira metadata.');
      const result = await jira.read(`issue/${key(before.id)}/editmeta`);
      requireThat(result?.fields && typeof result.fields === 'object' && !Array.isArray(result.fields), 'Xray Jira edit field metadata is incomplete.');
      fields = Object.entries(result.fields).map(([fieldId, value]) => ({...value, fieldId}));
    }
    fields = validateFieldMetadata(fields);
    requireThat(fields.length > 0 && fields.every(field => fieldId(field.fieldId)), 'Xray Jira field metadata is empty or contains invalid field IDs.');
    const permission = creating ? 'CREATE_ISSUES' : 'EDIT_ISSUES', scope = creating ? `projectKey=${project.key}` : `issueKey=${before.id}`;
    const permissions = await jira.read(`mypermissions?${scope}&permissions=${permission}`);
    requireThat(permissions.permissions?.[permission]?.havePermission === true, `Xray Jira ${creating ? 'creation' : 'edit'} permission is unavailable.`);
    const schema = {provider, siteUrl: config.siteUrl, project: project.key, projectId: String(project.id), creating, issueTypeId, fields, permission};
    return {...schema, fingerprint: fingerprint(schema)};
  }
  function caseValues(plan) {
    return {...plan.nativeFields, summary: plan.desired.title, labels: plan.desired.labels, ...(!plan.id ? {project: {id: plan.fieldSchema.projectId}, issuetype: {id: plan.fieldSchema.issueTypeId}} : {})};
  }
  function validateFieldReadback(schema, values, review) {
    const checked = new Set([...Object.keys(values), ...schema.fields.filter(field => field.required).map(field => field.fieldId), ...review.filter(row => row.defaulted).map(row => row.field)]);
    const problems = [...checked].filter(name => !readableField(name)).map(field => ({field, code: 'unsupported-readback'}));
    if (problems.length) throw Object.assign(new Error(`Xray fields cannot be retained for verified readback: ${problems.map(row => row.field).join(', ')}. Review these fields before approval.`), {fieldProblems: problems, fieldReview: review});
  }
  async function validateUsers(fields, values, issueKey) {
    const users = new Map();
    for (const field of fields) {
      const value = values[field.fieldId]; if (value === undefined || value === null) continue;
      const selected = field.schema?.type === 'user' ? [value] : field.schema?.type === 'array' && field.schema.items === 'user' ? value : [];
      for (const user of selected) users.set(`${field.fieldId === 'assignee' ? 'assignee' : 'user'}:${user.accountId}`, {accountId: user.accountId, assignee: field.fieldId === 'assignee'});
    }
    requireThat(users.size <= 100, 'Xray user fields exceed the 100-account validation bound.');
    for (const {accountId, assignee} of users.values()) {
      const encoded = encodeURIComponent(accountId);
      if (assignee) {
        const scope = issueKey ? `issueKey=${key(issueKey)}` : `project=${config.project}`;
        const matches = await jira.read(`user/assignable/search?${scope}&accountId=${encoded}&startAt=0&maxResults=2`);
        requireThat(Array.isArray(matches) && matches.length === 1 && matches[0].accountId === accountId && matches[0].active === true, 'Xray assignee must be the selected active, assignable Jira account.');
      } else {
        const user = await jira.read(`user?accountId=${encoded}`);
        requireThat(user?.accountId === accountId && user.active === true, 'Xray user fields must identify existing active Jira accounts.');
      }
    }
  }
  async function refreshCaseFields(plan, current) {
    requireThat(plan.fieldSchema && plan.nativeFields, 'Xray case plan needs a current approved native field schema.');
    const schema = await caseMetadata(plan.id ? current : undefined);
    requireThat(schema.fingerprint === plan.fieldSchema.fingerprint, 'Xray field metadata changed; refresh the preview and renew approval.');
    const review = validateNativeFields(schema.fields, caseValues(plan), {existing: current?.raw.issue.fields ?? {}, implicit: ['project', 'issuetype'], creating: !plan.id, label: 'Xray case'});
    validateFieldReadback(schema, plan.nativeFields, review);
    await validateUsers(schema.fields, plan.nativeFields, plan.id);
  }
  function verifyCaseFields(plan, item) {
    requireThat(item.raw.issue.fields.issuetype?.id === plan.fieldSchema.issueTypeId, 'Xray issue type differs from the approved native Test type at readback.');
    const defaults = !plan.id ? Object.fromEntries(plan.fieldReview.filter(row => row.defaulted && Object.hasOwn(row, 'value')).map(row => [row.field, row.value])) : {};
    const expected = {...defaults, ...plan.beforeFields, ...plan.nativeFields};
    for (const [name, value] of Object.entries(expected)) requireThat(sameFieldValue(item.raw.issue.fields[name], value), `Xray field ${name} differs from the approved or preserved value at readback.`);
    validateNativeFields(plan.fieldSchema.fields, {}, {existing: item.raw.issue.fields, creating: false, label: 'Xray case readback'});
    return item;
  }
  async function prepareCase(input) {
    const desired = desiredCase(input), before = input.before; await jira.projectIdentity();
    requireThat(before || input.storyKey, 'Xray creation needs a selected source story to verify the native credential site.');
    if (before) requireThat((await readCase(before.id)).fingerprint === before.fingerprint, 'Xray case changed; refresh and renew approval.');
    const link = input.storyKey ? await storyLink(input.storyKey, input.storyLinkTypeId) : {};
    const nativeFields = nativeFieldValues({...(!before ? nativeFieldValues(config.testManagement.caseFields) : {}), ...nativeFieldValues(input.nativeFields)});
    requireThat(Object.keys(nativeFields).every(name => fieldId(name) && !ownedFields.includes(name)), 'Xray native fields cannot replace owned case content, identity, links or status.');
    const fieldSchema = await caseMetadata(before), values = {...nativeFields, summary: desired.title, labels: desired.labels, ...(!before ? {project: {id: fieldSchema.projectId}, issuetype: {id: fieldSchema.issueTypeId}} : {})};
    const fieldReview = validateNativeFields(fieldSchema.fields, values, {existing: before?.raw.issue.fields ?? {}, implicit: ['project', 'issuetype'], creating: !before, label: 'Xray case'});
    validateFieldReadback(fieldSchema, nativeFields, fieldReview);
    await validateUsers(fieldSchema.fields, nativeFields, before?.id);
    const beforeFields = before ? Object.fromEntries([...new Set([...Object.keys(trackedFields(before.raw.issue.fields)), ...fieldSchema.fields.map(field => field.fieldId)])].filter(name => !ownedFields.includes(name)).map(name => [name, before.raw.issue.fields[name] ?? null])) : undefined;
    const requests = [];
    if (!before) requests.push(mutation('create-case', 'mutation($steps:[CreateStepInput],$jira:JSON!) { createTest(testType:{name:"Manual"},steps:$steps,jira:$jira) { test { issueId jira(fields:["key"]) } warnings } }', {steps: desired.steps.map(step => ({action: step.action, data: step.data, result: step.expected})), jira: {fields: values}}));
    else {
      requests.push(nativeRequest('update-case', `issue/${key(before.id)}`, 'PUT', {fields: values}, 'jira'));
      for (let index = 0; index < desired.steps.length; index++) {
        const step = desired.steps[index], value = {action: step.action, data: step.data, result: step.expected};
        requests.push(index < before.steps.length
          ? mutation('update-case-step', 'mutation($id:String!,$step:UpdateStepInput!) { updateTestStep(stepId:$id,step:$step) { warnings } }', {id: before.steps[index].id, step: value})
          : mutation('add-case-step', 'mutation($id:String!,$step:CreateStepInput!) { addTestStep(issueId:$id,step:$step) { id } }', {id: before.nativeId, step: value}));
      }
      for (const step of before.steps.slice(desired.steps.length)) requests.push(mutation('remove-case-step', 'mutation($id:String!) { removeTestStep(stepId:$id) }', {id: step.id}));
    }
    const beforeCase = before ? {title: before.title, labels: before.labels, steps: before.steps, preconditions: before.preconditions, description: before.raw.issue.fields.description ?? null} : undefined;
    return data({kind: 'case', provider, ...(before ? {id: before.id, beforeFingerprint: before.fingerprint, beforeCase, beforeFields} : {}), marker: input.marker, desired, fieldSchema, fieldReview, nativeFields, requests, ...link}, 4 * 1024 * 1024);
  }
  async function writeCase(plan, delivery, {onIdentity} = {}) {
    requireThat(plan.provider === provider && plan.kind === 'case', 'Invalid Xray case plan.');
    const current = plan.id ? await readCase(plan.id) : undefined;
    if (plan.id) requireThat(current.fingerprint === plan.beforeFingerprint, 'Xray case changed after preview.');
    else requireThat(plan.storyKey && String((await nativeStory(plan.storyKey)).id) === plan.storyId, 'Xray creation story binding changed.');
    await refreshCaseFields(plan, current);
    let id = plan.id;
    for (const request of plan.requests) {
      let remembered = false;
      const response = await writeRequest(delivery, request, {onIdentity: async identity => {await onIdentity?.(identity); remembered = true;}});
      if (!id) {id = key(response?.createTest?.test?.jira?.key); if (!remembered) await onIdentity?.({externalId: id});}
    }
    if (plan.storyKey) {
      const issue = await jira.issue(id), linked = (issue.fields.issuelinks ?? []).some(link => String(link.type?.id) === plan.linkType && link.outwardIssue?.key === plan.storyKey);
      if (!linked) await writeRequest(delivery, nativeRequest('link-case-story', 'issueLink', 'POST', {type: {id: plan.linkType}, inwardIssue: {key: id}, outwardIssue: {key: plan.storyKey}}, 'jira'));
    }
    return id;
  }
  async function verifyCase(plan, id) {
    const item = verifyCaseFields(plan, verifiedContent(plan, await readCase(id)));
    if (plan.storyKey) requireThat((item.raw.issue.fields.issuelinks ?? []).some(link => String(link.type?.id) === plan.linkType && link.outwardIssue?.key === plan.storyKey), 'Xray case lacks its approved coverage link.');
    return item;
  }
  async function findCase(marker) {
    requireThat(/^pom-harness-[a-z0-9-]{16,80}$/.test(marker), 'Invalid owned operation marker.');
    const results = await jira.search(`labels = "${marker}"`, {fields: ['project', 'labels'], maxItems: 2});
    requireThat(results.length <= 1, 'Operation marker matches multiple Jira cases; reconcile explicitly.');
    if (!results.length) return null;
    const issue = await jira.issue(key(results[0].key)); requireThat(issue.fields.labels?.includes(marker), 'Located Xray case marker differs.');
    const native = (await transport.query('query($id:String!) { getTest(issueId:$id) { issueId jira(fields:["key","project"]) } }', {id: String(issue.id)})).getTest;
    await requireNativeSite(native, issue);
    return {id: issue.key, nativeId: String(issue.id), title: issue.fields.summary, labels: issue.fields.labels};
  }
  async function caseCompletion(plan, id) {
    requireThat((!plan.id || plan.id === id) && plan.provider === provider && plan.kind === 'case', 'Completion requires the original native case plan and identity.');
    const current = await readCase(id); await refreshCaseFields(plan, current); let requests = [];
    if (!plan.id) verifyCaseFields(plan, verifiedContent(plan, current));
    else {
      const before = plan.beforeCase; requireThat(before && fingerprint(before.preconditions) === fingerprint(current.preconditions), 'Xray case recovery requires unchanged source context and its original snapshot.');
      requireThat(new Set(current.steps.map(step => step.id)).size === current.steps.length, 'Xray current step identities are duplicated.');
      const state = {...structuredClone(before), fields: structuredClone(plan.beforeFields)}, originalIds = new Set(before.steps.map(step => step.id));
      const matches = () => state.title === current.title && fingerprint([...state.labels].sort()) === fingerprint([...current.labels].sort()) && state.steps.length === current.steps.length
        && current.raw.issue.fields.issuetype?.id === plan.fieldSchema.issueTypeId && Object.entries(state.fields).every(([name, value]) => sameFieldValue(current.raw.issue.fields[name], value))
        && state.steps.every((step, index) => {const actual = current.steps[index]; return (step.id === null ? !originalIds.has(actual.id) : step.id === actual.id) && step.action === actual.action && step.data === actual.data && step.expected === actual.expected;});
      let completed = matches() ? 0 : -1;
      for (const [index, request] of plan.requests.entries()) {
        const variables = request.body?.variables;
        if (request.operation === 'update-case') {state.title = request.body.fields.summary; state.labels = request.body.fields.labels; Object.assign(state.fields, plan.nativeFields);}
        else if (request.operation === 'update-case-step') {
          const step = state.steps.find(step => step.id === variables.id); requireThat(step, 'Original Xray step update identity is missing.');
          Object.assign(step, {action: variables.step.action, data: variables.step.data, expected: variables.step.result});
        } else if (request.operation === 'add-case-step') state.steps.push({id: null, action: variables.step.action, data: variables.step.data, expected: variables.step.result});
        else if (request.operation === 'remove-case-step') {
          const position = state.steps.findIndex(step => step.id === variables.id); requireThat(position >= 0, 'Original Xray step removal identity is missing.'); state.steps.splice(position, 1);
        } else throw new Error('Unsupported original Xray case recovery operation.');
        if (matches()) completed = index + 1;
      }
      requireThat(completed >= 0, 'Xray case differs from every approved intermediate update state; reconcile unrelated edits.');
      requests = plan.requests.slice(completed);
    }
    if (plan.storyKey && !(current.raw.issue.fields.issuelinks ?? []).some(link => String(link.type?.id) === plan.linkType && link.outwardIssue?.key === plan.storyKey)) {
      requests.push(nativeRequest('link-case-story', 'issueLink', 'POST', {type: {id: plan.linkType}, inwardIssue: {key: id}, outwardIssue: {key: plan.storyKey}}, 'jira'));
    }
    return {complete: requests.length === 0, requests};
  }
  async function readRun(caseId, executionId) {
    const result = await transport.query(`query($test:String!,$execution:String!) { getTestRun(testIssueId:$test,testExecIssueId:$execution) { ${RUN_FIELDS} } }`, {test: caseId, execution: executionId});
    const run = result.getTestRun;
    requireThat(run && typeof run.id === 'string' && run.test?.issueId === caseId && run.testExecution?.issueId === executionId && Array.isArray(run.steps) && !(run.parameters?.length), 'Xray run identity/content is incomplete or parameterized.');
    return run;
  }
  async function prepareResults(input) {
    const group = await jira.issue(key(input.groupId)), project = await jira.projectIdentity(), results = validateResults(input.results);
    requireThat(/^pom-harness-[a-z0-9-]{16,80}$/.test(input.marker ?? ''), 'Result delivery needs a stable owned marker.');
    const metadata = await transport.query('query($project:String!) { getStatuses(projectId:$project) { name } getStepStatuses(projectId:$project) { name } }', {project: project.id});
    requireThat(Array.isArray(metadata.getStatuses) && Array.isArray(metadata.getStepStatuses), 'Xray statuses are incomplete.');
    const desired = [], requests = [];
    for (const row of results) {
      const item = await readCase(row.caseId), run = await readRun(item.nativeId, String(group.id));
      requireThat((input.automated === true && row.steps === undefined || Array.isArray(row.steps) && row.steps.length === item.steps.length) && run.steps.length === item.steps.length && run.steps.every((step, index) => step.action === item.steps[index].action && (step.data ?? '') === item.steps[index].data && step.result === item.steps[index].expected), 'Xray execution steps differ from the selected case; sync and refresh before approval.');
      const status = mappedStatus(row.outcome, input.statuses, metadata.getStatuses), comment = `${row.comment ?? ''}\n[${input.marker}:${row.caseId}]`;
      const steps = row.steps?.map((step, index) => ({id: run.steps[index].id, status: mappedStatus(step.outcome, input.stepStatuses ?? input.statuses, metadata.getStepStatuses), actualResult: step.actual ?? ''})) ?? null;
      for (const step of steps ?? []) requests.push(mutation('update-result-step', 'mutation($run:String!,$step:String!,$update:UpdateTestRunStepInput!) { updateTestRunStep(testRunId:$run,stepId:$step,updateData:$update) { warnings } }', {run: run.id, step: step.id, update: {status: step.status, actualResult: step.actualResult}}));
      requests.push(mutation('update-result-comment', 'mutation($id:String!,$comment:String!) { updateTestRunComment(id:$id,comment:$comment) }', {id: run.id, comment}));
      requests.push(mutation('update-result-status', 'mutation($id:String!,$status:String!) { updateTestRunStatus(id:$id,status:$status) }', {id: run.id, status}));
      const beforeRun = {comment: run.comment ?? '', status: run.status?.name, steps: run.steps.map(step => ({id: step.id, action: step.action, data: step.data ?? '', result: step.result, status: step.status?.name, actualResult: step.actualResult ?? ''}))};
      desired.push({caseId: row.caseId, nativeId: item.nativeId, beforeFingerprint: item.fingerprint, runId: run.id, runFingerprint: fingerprint(run), beforeRun, status, comment, steps});
    }
    return data({kind: 'results', provider, groupId: input.groupId, nativeGroupId: String(group.id), marker: input.marker, desired, requests}, 4 * 1024 * 1024);
  }
  async function writeResults(plan, delivery) {
    requireThat(plan.provider === provider && plan.kind === 'results', 'Invalid Xray results plan.');
    for (const row of plan.desired) requireThat((await readCase(row.caseId)).fingerprint === row.beforeFingerprint && fingerprint(await readRun(row.nativeId, plan.nativeGroupId)) === row.runFingerprint, 'Xray source case or execution changed after preview.');
    for (const request of plan.requests) await writeRequest(delivery, request);
    return plan.desired.map(row => ({caseId: row.caseId, id: row.runId}));
  }
  async function findResults(plan) {
    const identities = [];
    for (const row of plan.desired) {
      const run = await readRun(row.nativeId, plan.nativeGroupId);
      if (run.id === row.runId && run.status?.name === row.status && run.comment === row.comment && (row.steps === null || run.steps.length === row.steps.length && run.steps.every((step, index) => step.id === row.steps[index].id && step.status?.name === row.steps[index].status && (step.actualResult ?? '') === row.steps[index].actualResult))) identities.push({caseId: row.caseId, id: run.id});
    }
    return identities;
  }
  async function verifyResults(plan) {
    const identities = await findResults(plan); requireThat(identities.length === plan.desired.length, 'Xray result readback differs from approved run or step outcomes.'); return identities;
  }
  async function resultCompletion(plan) {
    requireThat(plan.provider === provider && plan.kind === 'results', 'Invalid Xray results plan.');
    const requests = [];
    for (const row of plan.desired) {
      requireThat(row.beforeRun && (await readCase(row.caseId)).fingerprint === row.beforeFingerprint, 'Xray result recovery needs the original unchanged source and captured run baseline.');
      const run = await readRun(row.nativeId, plan.nativeGroupId), before = row.beforeRun;
      requireThat(run.id === row.runId && run.steps.length === before.steps.length, 'Xray result run or step identity changed.');
      for (const [index, step] of run.steps.entries()) {
        const prior = before.steps[index], wanted = row.steps?.[index];
        requireThat(step.id === prior.id && step.action === prior.action && (step.data ?? '') === prior.data && step.result === prior.result, 'Xray run step content changed during recovery.');
        const actual = {status: step.status?.name, actualResult: step.actualResult ?? ''}, original = {status: prior.status, actualResult: prior.actualResult};
        const desired = wanted ? {status: wanted.status, actualResult: wanted.actualResult} : original;
        requireThat(fingerprint(actual) === fingerprint(original) || fingerprint(actual) === fingerprint(desired), 'Xray run step outcome changed outside the approved delivery.');
        if (wanted && fingerprint(actual) !== fingerprint(desired)) {
          const request = plan.requests.find(request => request.operation === 'update-result-step' && request.body.variables.run === row.runId && request.body.variables.step === step.id);
          requireThat(request, 'Original Xray step request is missing.'); requests.push(request);
        }
      }
      requireThat([before.comment, row.comment].includes(run.comment ?? '') && [before.status, row.status].includes(run.status?.name), 'Xray run outcome or comment changed outside the approved delivery.');
      for (const [operation, missing] of [['update-result-comment', (run.comment ?? '') !== row.comment], ['update-result-status', run.status?.name !== row.status]]) if (missing) {
        const request = plan.requests.find(request => request.operation === operation && request.body.variables.id === row.runId);
        requireThat(request, 'Original Xray result request is missing.'); requests.push(request);
      }
    }
    return {complete: requests.length === 0, requests};
  }
  async function property(id) {try {return (await jira.read(`issue/${key(id)}/properties/${PROPERTY}`)).value;} catch (error) {if (error.status === 404) return null; throw error;}}
  async function prepareAutomation({before, automated, identity}) {
    requireThat(typeof automated === 'boolean', 'Choose set or clear automation.'); key(before.id);
    requireThat((await readCase(before.id)).fingerprint === before.fingerprint, 'Xray case changed; renew automation approval.');
    const prior = await property(before.id), value = automated ? {version: 1, automated: true, ...automationIdentity(identity)} : null;
    const labels = before.labels.filter(label => label !== AUTOMATED_LABEL); if (automated) labels.push(AUTOMATED_LABEL);
    const requests = [nativeRequest('update-automation-status', `issue/${before.id}`, 'PUT', {fields: {labels}}, 'jira')];
    if (automated || prior !== null) requests.push(nativeRequest(automated ? 'set-automation-identity' : 'clear-automation-identity', `issue/${before.id}/properties/${PROPERTY}`, automated ? 'PUT' : 'DELETE', value ?? undefined, 'jira'));
    return data({kind: 'automation', provider, id: before.id, beforeFingerprint: before.fingerprint, beforeContent: fingerprint({title: before.title, steps: before.steps, preconditions: before.preconditions}), beforeLabels: before.labels, beforeProperty: prior,
      propertyFingerprint: fingerprint(prior), automated, identity: value, labels, requests});
  }
  async function writeAutomation(plan, delivery) {
    requireThat((await readCase(plan.id)).fingerprint === plan.beforeFingerprint && fingerprint(await property(plan.id)) === plan.propertyFingerprint, 'Xray case or automation mapping changed after preview.');
    for (const request of plan.requests) await writeRequest(delivery, request); return plan.id;
  }
  async function verifyAutomation(plan) {const item = await readCase(plan.id); requireThat(fingerprint(item.labels) === fingerprint(plan.labels) && fingerprint(await property(plan.id)) === fingerprint(plan.identity), 'Xray automation identity/status readback differs.'); return item;}
  async function automationCompletion(plan) {
    const item = await readCase(plan.id), current = await property(plan.id), requests = [];
    requireThat(plan.beforeContent === fingerprint({title: item.title, steps: item.steps, preconditions: item.preconditions}), 'Xray source changed outside the approved automation update.');
    const actualLabels = fingerprint([...item.labels].sort()), beforeLabels = fingerprint([...plan.beforeLabels].sort()), desiredLabels = fingerprint([...plan.labels].sort());
    requireThat([beforeLabels, desiredLabels].includes(actualLabels) && [fingerprint(plan.beforeProperty), fingerprint(plan.identity)].includes(fingerprint(current)), 'Xray automation mapping changed outside the approved update.');
    if (actualLabels !== desiredLabels) requests.push(...plan.requests.filter(request => request.operation === 'update-automation-status'));
    if (fingerprint(current) !== fingerprint(plan.identity)) requests.push(...plan.requests.filter(request => request.operation !== 'update-automation-status'));
    return {complete: requests.length === 0, requests};
  }
  return Object.freeze({provider, capabilities, readCase, storyCases, groupCases, prepareCase, writeCase, verifyCase, findCase, caseCompletion, prepareResults, writeResults, verifyResults, findResults, resultCompletion, reconcileResults: verifyResults, prepareAutomation, writeAutomation, verifyAutomation, automationCompletion,
    delivery: (kind, execute, sourceFingerprint) => testManagementDelivery({jira, transport, roots, provider}, kind, execute, sourceFingerprint)});
}
