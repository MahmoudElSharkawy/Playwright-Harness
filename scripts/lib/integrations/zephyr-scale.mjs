import {data, fingerprint, requireThat} from '../execution-core/data.mjs';
import {capabilities, desiredCase, verifiedContent, automationIdentity, mappedStatus, validateResults, nativeRequest, writeRequest, testManagementDelivery} from './test-management-common.mjs';

const AUTOMATION_START = '\n[pom-harness:automation]\n', AUTOMATION_END = '\n[/pom-harness:automation]';
const AUTOMATED_LABEL = 'pom-harness-automated';
const numberId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function createZephyrScaleAdapter({jira, transport, roots}) {
  const provider = 'zephyr-scale', config = jira.configuration;
  function key(value, type = 'T') {requireThat(typeof value === 'string' && new RegExp(`^${config.project}-${type}[1-9]\\d*$`).test(value), 'Zephyr key must belong to the selected project and resource type.'); return value;}
  let project;
  async function projectIdentity() {
    if (!project) project = Promise.resolve().then(async () => {
      const expected = await jira.projectIdentity(), result = await transport.read(`projects/${config.project}`);
      requireThat(numberId(result.id) && result.key === config.project && String(result.jiraProjectId) === expected.id && result.enabled === true, 'Zephyr project identity differs from selected Jira project or is disabled.');
      return {id: String(result.id), key: result.key};
    }).catch(error => {project = undefined; throw error;});
    return project;
  }
  async function owned(value) {const expected = await projectIdentity(); requireThat(String(value?.project?.id) === expected.id, 'Zephyr resource project ownership is incomplete.'); return value;}
  async function readCase(id, {allowEmpty = false} = {}) {
    key(id); await projectIdentity(); const raw = await owned(await transport.read(`testcases/${id}`));
    requireThat(raw.key === id && numberId(raw.id) && typeof raw.name === 'string' && Array.isArray(raw.labels ?? []), 'Zephyr case identity/content is incomplete.');
    const rawSteps = await transport.list(`testcases/${id}/teststeps`, {maxItems: 500});
    requireThat(allowEmpty || rawSteps.length > 0, 'Zephyr case has no executable ordered steps.');
    const steps = [];
    for (const step of rawSteps) {
      requireThat(numberId(step.id) && step.inline && !step.testCase && !step.inline.reflectRef && !step.inline.testDataRowNumber && !Object.keys(step.inline.customFields ?? {}).length && !(step.attachments?.length), 'Zephyr called, parameterized, custom or attached steps are unsupported; preserve them for native review.');
      const attachments = await transport.list(`testcases/${id}/teststeps/${step.id}/attachments`, {maxItems: 500});
      requireThat(attachments.length === 0, 'Zephyr step attachments are unsupported for an overwrite; preserve them for native review.');
      requireThat(typeof step.inline.description === 'string' && typeof step.inline.expectedResult === 'string', 'Zephyr step content is incomplete.');
      steps.push({id: String(step.id), action: step.inline.description, data: step.inline.testData ?? '', expected: step.inline.expectedResult});
    }
    const retained = data({case: raw, steps: rawSteps}, 2 * 1024 * 1024), version = fingerprint(retained);
    return {provider, siteUrl: config.siteUrl, project: config.project, id, nativeId: String(raw.id), revision: version, fingerprint: version, title: raw.name, steps,
      preconditions: raw.precondition ? [{id: `${id}-precondition`, text: raw.precondition}] : [], description: raw.objective ?? '', labels: raw.labels ?? [],
      externalReferences: [{system: provider, id: `${config.siteUrl}/projects/${config.project}?selectedItem=com.kanoah.test-manager__main-project-page#!/testCase/${id}`}], raw: retained};
  }
  async function storyCases(storyKey) {
    await jira.issue(storyKey); await projectIdentity(); const linked = await transport.read(`issuelinks/${storyKey}/testcases`);
    requireThat(Array.isArray(linked) && linked.length <= 500 && new Set(linked.map(item => item.key)).size === linked.length, 'Zephyr story-linked cases are incomplete.');
    const results = []; for (const item of linked) results.push(await readCase(key(item.key))); return results;
  }
  async function groupCases({kind, id}) {
    requireThat(['cycle', 'plan', 'folder'].includes(kind), 'Select a Zephyr cycle, plan or test-case folder.'); await projectIdentity();
    if (kind === 'folder') {
      requireThat(numberId(id), 'Zephyr folder identity must be positive.');
      const folder = await owned(await transport.read(`folders/${id}`)); requireThat(folder.folderType === 'TEST_CASE', 'Select a test-case folder.');
      const cases = await transport.list(`testcases?projectKey=${config.project}&folderId=${id}`, {maxItems: 500});
      const items = []; for (const item of cases) items.push(await readCase(key(item.key))); return items;
    }
    const cycles = [];
    if (kind === 'plan') {
      key(id, 'P'); await owned(await transport.read(`testplans/${id}`)); const links = await transport.read(`testplans/${id}/links`);
      requireThat(Array.isArray(links.testCycles) && links.testCycles.length <= 100, 'Zephyr plan cycle links are incomplete.');
      for (const link of links.testCycles) {requireThat(numberId(link.testCycleId), 'Invalid Zephyr linked cycle.'); cycles.push(String(link.testCycleId));}
    } else cycles.push(key(id, 'R'));
    const selected = new Map();
    for (const cycleId of cycles) {
      const cycle = await owned(await transport.read(`testcycles/${cycleId}`)); key(cycle.key, 'R');
      const executions = await transport.list(`testexecutions?projectKey=${config.project}&testCycle=${encodeURIComponent(cycle.key)}&onlyLastExecutions=true`, {maxItems: 500});
      for (const execution of executions) {
        await owned(execution); const caseKey = caseFromLink(execution.testCase); selected.set(caseKey, caseKey); requireThat(selected.size <= 500, 'Zephyr grouping exceeds 500 cases.');
      }
    }
    const result = []; for (const id of selected.keys()) result.push(await readCase(id)); return result;
  }
  function caseFromLink(link) {
    const base = transport.base;
    requireThat(typeof link?.self === 'string' && link.self.startsWith(base + 'testcases/'), 'Zephyr case result has an unverified destination.');
    const match = /^([^/]+)\/versions\/[1-9]\d*$/.exec(link.self.slice((base + 'testcases/').length));
    requireThat(match, 'Zephyr case version identity is incomplete.'); return key(match[1]);
  }
  function metadata(before, changes) {
    const raw = structuredClone(before.raw.case);
    for (const name of ['createdOn', 'testScript', 'links', 'self']) delete raw[name];
    return {...raw, ...changes};
  }
  function stepRequests(id, desired) {
    const requests = [];
    for (let start = 0; start < desired.steps.length; start += 100) requests.push(nativeRequest('write-case-steps', `testcases/${id}/teststeps`, 'POST', {mode: start ? 'APPEND' : 'OVERWRITE', items: desired.steps.slice(start, start + 100).map(step => ({inline: {description: step.action, testData: step.data, expectedResult: step.expected}}))}));
    return requests;
  }
  async function prepareCase(input) {
    const desired = desiredCase(input); requireThat(desired.labels.length <= 50, 'Zephyr cases support at most 50 labels.'); await projectIdentity();
    const before = input.before;
    if (before) {key(before.id); const fresh = await readCase(before.id); requireThat(before.fingerprint === fresh.fingerprint, 'Zephyr case changed; refresh and renew approval.');}
    let story; if (input.storyKey) {story = await jira.issue(input.storyKey); requireThat(numberId(story.id), 'Jira story identity is incomplete.');}
    const requests = before ? [nativeRequest('update-case', `testcases/${before.id}`, 'PUT', metadata(before, {name: desired.title, labels: desired.labels})), ...stepRequests(before.id, desired)]
      : [nativeRequest('create-case', 'testcases', 'POST', {projectKey: config.project, name: desired.title, labels: desired.labels})];
    return data({kind: 'case', provider, ...(before ? {id: before.id, beforeFingerprint: before.fingerprint, beforeCase: {metadata: metadata(before, {labels: [...before.labels].sort()}), steps: before.steps}} : {}), marker: input.marker, desired, requests,
      ...(story ? {storyKey: story.key, storyId: String(story.id)} : {})}, 4 * 1024 * 1024);
  }
  async function writeCase(plan, delivery, {onIdentity} = {}) {
    requireThat(plan.provider === provider && plan.kind === 'case', 'Invalid Zephyr case plan.');
    if (plan.id) requireThat((await readCase(plan.id)).fingerprint === plan.beforeFingerprint, 'Zephyr case changed after preview.');
    let id = plan.id;
    for (const request of plan.requests) {
      let remembered = false;
      const result = await writeRequest(delivery, request, {onIdentity: async identity => {await onIdentity?.(identity); remembered = true;}});
      if (!id) {id = key(result?.key); if (!remembered) await onIdentity?.({externalId: id});}
    }
    if (!plan.id) for (const request of stepRequests(id, plan.desired)) await writeRequest(delivery, request);
    if (plan.storyId) {
      const links = await transport.read(`testcases/${id}/links`); requireThat(Array.isArray(links.issues), 'Zephyr case links are incomplete.');
      if (!links.issues.some(link => String(link.issueId) === plan.storyId)) await writeRequest(delivery, nativeRequest('link-case-story', `testcases/${id}/links/issues`, 'POST', {issueId: Number(plan.storyId)}));
    }
    return id;
  }
  async function verifyCase(plan, id) {
    const item = verifiedContent(plan, await readCase(id));
    const approved = plan.requests.find(request => request.method === 'PUT' && request.route === `testcases/${id}`)?.body;
    if (approved) requireThat(fingerprint(metadata(item, {labels: [...item.labels].sort()})) === fingerprint({...approved, labels: [...approved.labels].sort()}), 'Zephyr case metadata was not preserved by the approved update.');
    if (plan.storyId) {const links = await transport.read(`testcases/${id}/links`); requireThat(links.issues?.some(link => String(link.issueId) === plan.storyId), 'Created case lacks the approved story link.');}
    return item;
  }
  async function findCase(marker) {
    requireThat(/^pom-harness-[a-z0-9-]{16,80}$/.test(marker), 'Invalid owned operation marker.');
    const values = await transport.list(`testcases?projectKey=${config.project}`, {maxItems: 10000});
    const found = values.filter(item => item.labels?.includes(marker)); requireThat(found.length <= 1, 'Operation marker matches multiple Zephyr cases; reconcile explicitly.');
    if (!found.length) return null;
    const id = key(found[0].key), item = await owned(await transport.read(`testcases/${id}`));
    requireThat(item.key === id && numberId(item.id) && item.labels?.includes(marker), 'Located Zephyr case identity or marker differs.');
    return {id, nativeId: String(item.id), title: item.name, labels: item.labels};
  }
  async function caseCompletion(plan, id) {
    requireThat((!plan.id || plan.id === id) && plan.provider === provider && plan.kind === 'case', 'Completion requires the original native case plan and identity.');
    const current = await readCase(id, {allowEmpty: true});
    let requests;
    if (plan.id) {
      requireThat(plan.beforeCase, 'Zephyr case recovery requires its original snapshot.');
      requireThat(new Set(current.steps.map(step => step.id)).size === current.steps.length, 'Zephyr current step identities are duplicated.');
      const state = structuredClone(plan.beforeCase), actualMetadata = fingerprint(metadata(current, {labels: [...current.labels].sort()}));
      const matches = () => fingerprint(state.metadata) === actualMetadata && state.steps.length === current.steps.length
        && state.steps.every((step, index) => {const actual = current.steps[index]; return (step.id === null || step.id === actual.id) && step.action === actual.action && step.data === actual.data && step.expected === actual.expected;});
      let completed = matches() ? 0 : -1;
      for (const [index, request] of plan.requests.entries()) {
        if (request.operation === 'update-case') state.metadata = {...request.body, labels: [...request.body.labels].sort()};
        else if (request.operation === 'write-case-steps') {
          requireThat(['OVERWRITE', 'APPEND'].includes(request.body.mode), 'Unknown Zephyr step recovery mode.');
          const steps = request.body.items.map(item => ({id: null, action: item.inline.description, data: item.inline.testData, expected: item.inline.expectedResult}));
          state.steps = request.body.mode === 'OVERWRITE' ? steps : [...state.steps, ...steps];
        } else throw new Error('Unsupported original Zephyr case recovery operation.');
        if (matches()) completed = index + 1;
      }
      requireThat(completed >= 0, 'Zephyr case metadata or steps differ from every approved intermediate update state; reconcile unrelated edits.');
      requests = plan.requests.slice(completed);
    } else {
      requireThat(current.title === plan.desired.title && fingerprint([...current.labels].sort()) === fingerprint([...plan.desired.labels].sort()), 'Located Zephyr case metadata differs from the approved creation.');
      requireThat(current.steps.length <= plan.desired.steps.length && current.steps.every((step, index) => fingerprint({action: step.action, data: step.data, expected: step.expected}) === fingerprint(plan.desired.steps[index])), 'Located Zephyr steps differ from the exact approved ordered prefix.');
      requireThat(current.steps.length === plan.desired.steps.length || current.steps.length % 100 === 0, 'Zephyr creation contains an incomplete native step batch; reconcile natively.');
      requests = current.steps.length === plan.desired.steps.length ? [] : stepRequests(id, plan.desired).slice(current.steps.length / 100);
    }
    if (plan.storyId) {
      const links = await transport.read(`testcases/${id}/links`); requireThat(Array.isArray(links.issues), 'Zephyr case links are incomplete.');
      if (!links.issues.some(link => String(link.issueId) === plan.storyId)) requests.push(nativeRequest('link-case-story', `testcases/${id}/links/issues`, 'POST', {issueId: Number(plan.storyId)}));
    }
    return {complete: requests.length === 0, requests};
  }
  async function prepareResults(input) {
    key(input.groupId, 'R'); await owned(await transport.read(`testcycles/${input.groupId}`));
    requireThat(/^pom-harness-[a-z0-9-]{16,80}$/.test(input.marker ?? ''), 'Result delivery needs a stable owned marker.');
    const statuses = await transport.list(`statuses?projectKey=${config.project}&statusType=TEST_EXECUTION`, {maxItems: 1000}), results = validateResults(input.results), requests = [], desired = [];
    for (const row of results) {
      const item = await readCase(row.caseId), statusName = mappedStatus(row.outcome, input.statuses, statuses);
      requireThat(input.automated === true && row.steps === undefined || Array.isArray(row.steps) && row.steps.length === item.steps.length, 'Every Zephyr manual case step needs an explicit result.');
      const testScriptResults = row.steps?.map(step => ({statusName: mappedStatus(step.outcome, input.stepStatuses ?? input.statuses, statuses), actualResult: step.actual ?? ''}));
      const comment = `${row.comment ?? ''}\n[${input.marker}:${row.caseId}]`, body = {projectKey: config.project, testCaseKey: row.caseId, testCycleKey: input.groupId, statusName, ...(testScriptResults ? {testScriptResults} : {}), comment, automated: input.automated === true};
      requests.push(nativeRequest('create-result', 'testexecutions', 'POST', body)); desired.push({caseId: row.caseId, beforeFingerprint: item.fingerprint, body});
    }
    return data({kind: 'results', provider, groupId: input.groupId, marker: input.marker, desired, requests}, 4 * 1024 * 1024);
  }
  async function writeResults(plan, delivery, {onIdentity} = {}) {
    requireThat(plan.provider === provider && plan.kind === 'results', 'Invalid Zephyr results plan.'); const identities = [];
    for (const row of plan.desired) requireThat((await readCase(row.caseId)).fingerprint === row.beforeFingerprint, 'Zephyr source case changed after results preview.');
    for (let index = 0; index < plan.requests.length; index++) {
      let acknowledged = false;
      const remember = async value => {const id = value.externalId ?? value.id; requireThat(numberId(id), 'Zephyr result creation lacks an identity.'); await onIdentity?.({caseId: plan.desired[index].caseId, id: String(id)}); acknowledged = true;};
      const result = await writeRequest(delivery, plan.requests[index], {onIdentity: remember}); requireThat(numberId(result?.id), 'Zephyr result creation lacks an identity.');
      const identity = {caseId: plan.desired[index].caseId, id: String(result.id)}; identities.push(identity); if (!acknowledged) await remember(result);
    }
    return identities;
  }
  async function verifyResults(plan, identities) {
    requireThat(Array.isArray(identities) && identities.length === plan.desired.length && new Set(identities.map(row => row.id)).size === identities.length, 'Result readback needs distinct acknowledged identities.');
    const statuses = await transport.list(`statuses?projectKey=${config.project}&statusType=TEST_EXECUTION`, {maxItems: 1000});
    const name = value => statuses.find(status => String(status.id) === String(value?.id))?.name;
    for (const desired of plan.desired) {
      const identity = identities.find(row => row.caseId === desired.caseId); requireThat(identity && numberId(identity.id), 'Missing acknowledged case result.');
      const value = await owned(await transport.read(`testexecutions/${identity.id}`)), cycle = await owned(await transport.read(`testcycles/${plan.groupId}`));
      requireThat(caseFromLink(value.testCase) === desired.caseId && String(value.testCycle?.id) === String(cycle.id) && name(value.testExecutionStatus) === desired.body.statusName && value.comment === desired.body.comment && value.automated === desired.body.automated, 'Zephyr result readback differs from the approved destination or outcome.');
      if (desired.body.testScriptResults) {
        const steps = await transport.list(`testexecutions/${identity.id}/teststeps`, {maxItems: 500});
        requireThat(steps.length === desired.body.testScriptResults.length && steps.every((step, index) => name(step.inline?.status) === desired.body.testScriptResults[index].statusName && (step.inline?.actualResult ?? '') === desired.body.testScriptResults[index].actualResult), 'Zephyr step-result readback differs from approved outcomes.');
      }
    }
    return identities;
  }
  async function findResults(plan, knownIdentities = []) {
    requireThat(plan.provider === provider && plan.kind === 'results', 'Invalid Zephyr results plan.');
    const cycle = await owned(await transport.read(`testcycles/${key(plan.groupId, 'R')}`));
    const rows = await transport.list(`testexecutions?projectKey=${config.project}&testCycle=${encodeURIComponent(plan.groupId)}`, {maxItems: 10000}), identities = [];
    for (const desired of plan.desired) {
      const matches = [];
      for (const row of rows) if (row.comment === desired.body.comment) {
        await owned(row);
        if (String(row.testCycle?.id) === String(cycle.id) && caseFromLink(row.testCase) === desired.caseId) matches.push(row);
      }
      requireThat(matches.length <= 1, 'Zephyr result reconciliation is ambiguous; inspect owned remote results.');
      const known = knownIdentities.find(row => row.caseId === desired.caseId);
      if (!matches.length) {requireThat(!known, 'Acknowledged Zephyr result cannot be found by its operation marker.'); continue;}
      const identity = {caseId: desired.caseId, id: String(matches[0].id)};
      requireThat(!known || String(known.id) === identity.id, 'Acknowledged Zephyr result differs from its operation marker.'); identities.push(identity);
    }
    if (!identities.length) return [];
    return verifyResults({...plan, desired: plan.desired.filter(row => identities.some(item => item.caseId === row.caseId))}, identities);
  }
  async function reconcileResults(plan, knownIdentities = []) {
    const identities = await findResults(plan, knownIdentities);
    requireThat(identities.length === plan.desired.length, 'Zephyr result publication remains incomplete; no automatic create replay.');
    return identities;
  }
  function automationObjective(before, value) {
    const text = before.raw.case.objective ?? ''; requireThat(typeof text === 'string', 'Unsupported Zephyr objective.');
    const start = text.indexOf(AUTOMATION_START), end = text.indexOf(AUTOMATION_END);
    requireThat((start === -1) === (end === -1) && (start === -1 || end > start && text.indexOf(AUTOMATION_START, start + 1) === -1 && text.indexOf(AUTOMATION_END, end + 1) === -1), 'Owned automation metadata is ambiguous; reconcile first.');
    const clean = start === -1 ? text : text.slice(0, start) + text.slice(end + AUTOMATION_END.length);
    return clean + (value ? AUTOMATION_START + JSON.stringify(value) + AUTOMATION_END : '');
  }
  async function prepareAutomation({before, automated, identity}) {
    requireThat(typeof automated === 'boolean', 'Choose set or clear automation.'); key(before.id);
    requireThat((await readCase(before.id)).fingerprint === before.fingerprint, 'Zephyr case changed; renew automation approval.');
    const value = automated ? automationIdentity(identity) : null, labels = before.labels.filter(label => label !== AUTOMATED_LABEL); if (automated) labels.push(AUTOMATED_LABEL);
    const desired = {labels, objective: automationObjective(before, value)};
    return data({kind: 'automation', provider, id: before.id, beforeFingerprint: before.fingerprint, automated, identity: value, desired, requests: [nativeRequest('update-automation', `testcases/${before.id}`, 'PUT', metadata(before, desired))]});
  }
  async function writeAutomation(plan, delivery) {requireThat((await readCase(plan.id)).fingerprint === plan.beforeFingerprint, 'Zephyr case changed after automation preview.'); for (const request of plan.requests) await writeRequest(delivery, request); return plan.id;}
  async function verifyAutomation(plan) {
    const current = await readCase(plan.id), approved = plan.requests[0].body;
    requireThat(fingerprint(metadata(current, {labels: [...current.labels].sort()})) === fingerprint({...approved, labels: [...approved.labels].sort()}), 'Zephyr automation identity/status or preserved metadata readback differs.'); return current;
  }
  async function automationCompletion(plan) {
    const current = await readCase(plan.id), approved = plan.requests[0].body;
    if (fingerprint(metadata(current, {labels: [...current.labels].sort()})) === fingerprint({...approved, labels: [...approved.labels].sort()})) return {complete: true, requests: []};
    requireThat(current.fingerprint === plan.beforeFingerprint, 'Zephyr source changed outside the approved automation update.');
    return {complete: false, requests: plan.requests};
  }
  return Object.freeze({provider, capabilities, readCase, storyCases, groupCases, prepareCase, writeCase, verifyCase, findCase, caseCompletion, prepareResults, writeResults, verifyResults, findResults, reconcileResults, prepareAutomation, writeAutomation, verifyAutomation, automationCompletion,
    delivery: (kind, execute, sourceFingerprint) => testManagementDelivery({jira, transport, roots, provider}, kind, execute, sourceFingerprint)});
}
