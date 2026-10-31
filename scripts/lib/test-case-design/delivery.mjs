import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {readBounded, writeJson} from '../execute/storage.mjs';
import {requirementsClient} from '../requirements/sources.mjs';
import {adoRequestFingerprint} from '../integrations/ado-client.mjs';
import {workItemLinkId, adoId, validateCaseFieldValues} from '../integrations/config.mjs';
import {prepareCaseOperation, verifyCaseOperation} from '../integrations/ado-case-design.mjs';
import {readDesign, lockDesign, saveDesignState, designPath, requireReviewed, stateToDesignView, compactCoverage} from './index.mjs';
import {requireFreshDesign} from './sources.mjs';
import {requireFreshReferences} from './references.mjs';
import {coverage, renderDesign, preparationSteps, confirmedOutcomes} from './review.mjs';

function planContent(plan) {const {fingerprint: approved, ...content} = plan; requireThat(/^[a-f0-9]{64}$/.test(approved) && fingerprint(content) === approved, 'Saved approval plan changed; inspect the original immutable preview.'); return plan;}
function readPlan(roots, designId, approval) {requireThat(typeof approval === 'string' && /^[a-f0-9]{64}$/.test(approval), 'Publication requires the exact preview approval fingerprint.'); const plan = planContent(readBounded(designPath(roots, designId, `previews/${approval}.json`))); requireThat(plan.fingerprint === approval, 'Saved preview no longer matches the approved identity.'); return plan;}
async function currentOperation(client, state, operation) {
  const current = await prepareCaseOperation(client, state, state.draft.cases.find(row => row.id === operation.caseId), {fields: operation.publicationFields?.overrides ?? {}});
  // Legacy previews never carried field metadata. Fresh validation still checks their exact native request.
  if (!Object.hasOwn(operation, 'publicationFields')) delete current.publicationFields;
  return current;
}
function nativeFieldPreview(operation) {
  const native = new Set(['System.Title', 'System.Description', 'Microsoft.VSTS.TCM.Steps', 'System.Tags', 'System.History']);
  const fields = Object.entries(operation.fields).filter(([name]) => !native.has(name) && operation.request?.body.some(row => row.path === `/fields/${name}`)).map(([referenceName, value]) => ({
    referenceName, label: operation.publicationFields?.schema.find(field => field.referenceName === referenceName)?.name ?? referenceName, value,
    ...(operation.before && Object.hasOwn(operation.before.fields, referenceName) ? {before: operation.before.fields[referenceName]} : {})
  }));
  for (const [referenceName, value] of Object.entries(operation.publicationFields?.defaults ?? {})) fields.push({referenceName, label: operation.publicationFields.schema.find(field => field.referenceName === referenceName)?.name ?? referenceName, value, source: 'server-default'});
  return {caseId: operation.caseId, action: operation.action, fields};
}
function result(roots, state, delivery = state.delivery) {
  const outcomes = delivery.outcomes, assessedCoverage = coverage(state, undefined, {confirmed: true, roots});
  return {mode: outcomes.every(row => ['applied', 'unchanged'].includes(row.status)) ? 'completed' : outcomes.some(row => row.status === 'uncertain') ? 'reconciliation-required' : 'incomplete', approval: delivery.approval, outcomes, coverage: assessedCoverage, execution: 'not-run', presentation: {coverage: compactCoverage(assessedCoverage, state)}};
}
function requireBinding(state, plan) {
  requireThat(state.proposal === plan.proposal && state.source === plan.source && state.assessment === plan.assessment && state.consumer === plan.consumer && (state.approvalGeneration ?? 0) === (plan.approvalGeneration ?? 0), 'Proposal, source, assessment, approval generation or consumer changed; obtain renewed approval.');
}
const requestFingerprint = operation => operation.request ? adoRequestFingerprint(operation.request.route, operation.request.method, operation.request.body) : null;
const completedOutcome = (state, operation) => confirmedOutcomes(state).find(row => row.caseId === operation.caseId && row.operationId === operation.identity && row.requestFingerprint === requestFingerprint(operation));
async function destination(client, plan) {
  const project = await client.projectIdentity();
  requireThat(plan.destination.organizationUrl === client.configuration.organizationUrl && plan.destination.projectId.toLowerCase() === project.id.toLowerCase(), 'Configured destination changed; obtain renewed approval.'); return project;
}
async function makePlan(roots, state, options) {
  const selected = requireReviewed(state, options.selected, roots);
  const fields = new Map(), input = options.fields;
  if (input !== undefined) {
    requireThat(input && input.version === 1 && Object.keys(input).every(key => ['version', 'cases'].includes(key)) && Array.isArray(input.cases) && input.cases.length <= selected.length, 'Publication fields need version 1 and selected cases.');
    for (const row of input.cases) {
      requireThat(row && Object.keys(row).every(key => ['caseId', 'fields'].includes(key)) && typeof row.caseId === 'string' && selected.includes(row.caseId) && !fields.has(row.caseId), 'Publication field choices must identify unique selected cases.');
      fields.set(row.caseId, validateCaseFieldValues(row.fields));
    }
  }
  requireThat(state.evidence.requirements.origin, 'Local design works without ADO; publication requires a captured originating story and configured access.');
  await requireFreshDesign(roots, state, {...options, selected});
  const client = requirementsClient(roots, options), project = await client.projectIdentity(), origin = state.evidence.requirements.origin;
  requireThat(origin.organizationUrl === client.configuration.organizationUrl && origin.projectId.toLowerCase() === project.id.toLowerCase(), 'Source and configured publication destination differ.');
  const operations = [], confirmed = [], fieldProblems = [];
  for (const id of selected) {
    const outcome = confirmedOutcomes(state).find(row => row.caseId === id);
    if (outcome) {
      const approved = readPlan(roots, state.id, outcome.approval); requireBinding(state, approved);
      const operation = approved.operations.find(row => row.caseId === id);
      requireThat(operation && completedOutcome(state, operation), 'Confirmed operation no longer matches its approved intent.');
      requireThat(!fields.has(id) || fingerprint(fields.get(id)) === fingerprint(operation.publicationFields?.overrides ?? {}), 'Completed field intent changed; refresh and propose an Update using the returned ADO ID.');
      await verifyCaseOperation(client, operation, outcome.adoId, {historical: true});
      operations.push(operation); confirmed.push({caseId: id, adoId: outcome.adoId, status: outcome.status});
    } else {
      requireThat(!state.created[id], 'This temporary ID was already created; refresh and use its returned ADO ID.');
      try {operations.push(await prepareCaseOperation(client, state, state.draft.cases.find(row => row.id === id), {fields: fields.get(id) ?? {}}));}
      catch (error) {if (!error.fieldProblems) throw error; fieldProblems.push(`${id}: ${error.fieldProblems.join('; ')}`);}
    }
  }
  requireThat(!fieldProblems.length, `Test Case publication fields need correction: ${fieldProblems.join(' | ')}.`);
  const plan = {version: 1, consumer: state.consumer, source: state.source, proposal: state.proposal, assessment: state.assessment, approvalGeneration: state.approvalGeneration ?? 0, selected, confirmed,
    destination: {organizationUrl: client.configuration.organizationUrl, projectId: project.id, project: project.name, storyId: origin.storyId}, operations,
    coverage: coverage(state, selected, {roots}), rendered: renderDesign(state.draft, state), fieldPreview: operations.map(nativeFieldPreview), preparationPreview: selected.map(id => ({caseId: id, steps: preparationSteps(state.draft.cases.find(row => row.id === id), state.draft.preparations.find(row => row.caseId === id))})), note: 'Creation links to the story atomically. Native History records a per-operation recovery marker. Existing unrelated Description, tags and relationships are preserved. Validate-only requests check fields, rules and permissions; they do not publish cases.'};
  return {...plan, fingerprint: fingerprint(plan)};
}
export async function previewDesign(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    const state = readDesign(roots, designId); requireThat(!state?.delivery || state.delivery.outcomes.every(row => ['applied', 'unchanged', 'failed'].includes(row.status)), 'Reconcile unfinished delivery before another preview.');
    const plan = await makePlan(roots, state, options), path = designPath(roots, designId, `previews/${plan.fingerprint}.json`);
    if (!existsSync(path)) writeJson(path, plan, {exclusive: true, maxNodes: 500000});
    const view = stateToDesignView(roots, state, plan.selected, {lockHeld: true, publication: plan});
    return {...plan, presentation: {rendered: view.rendered, reviewFile: view.reviewFile, nativePreview: view.nativePreview, coverage: compactCoverage(plan.coverage, state)}};
  } finally {release();}
}

export async function publishDesign(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    let state = readDesign(roots, designId); const plan = readPlan(roots, designId, options.approval); requireBinding(state, plan);
    const client = requirementsClient(roots, options); await destination(client, plan);
    const archived = state.deliveryHistory?.find(delivery => delivery.approval === plan.fingerprint);
    if (archived) return result(roots, state, archived);
    if (state.delivery) {
      if (state.delivery.approval !== plan.fingerprint) requireThat(state.delivery.outcomes.every(row => ['applied', 'unchanged', 'failed'].includes(row.status)), 'Reconcile the previous approved delivery before using another preview.');
      else {
        if (state.delivery.outcomes.some(row => ['uncertain', 'dispatching'].includes(row.status))) return {...result(roots, state), mode: 'reconciliation-required'};
        if (state.delivery.outcomes.every(row => ['applied', 'unchanged'].includes(row.status))) return result(roots, state);
      }
    }
    const selected = plan.selected.filter(id => !completedOutcome(state, plan.operations.find(row => row.caseId === id)));
    if (selected.length) {
      requireReviewed(state, selected, roots);
      await requireFreshDesign(roots, state, {...options, selected});
    }
    // Verify prior completed operations and validate every pending case before writing.
    for (const operation of plan.operations) {
      const completed = completedOutcome(state, operation);
      if (completed) {await verifyCaseOperation(client, operation, completed.adoId, {historical: true}); continue;}
      requireThat(!state.created[operation.caseId], 'This temporary ID was already created; refresh and use its returned ADO ID.');
      const current = await currentOperation(client, state, operation);
      requireThat(fingerprint(current) === fingerprint(operation), 'Native request changed; review and approve a new preview.');
    }
    if (state.delivery?.approval !== plan.fingerprint) state = saveDesignState(roots, designId, {...state, deliveryHistory: [...(state.deliveryHistory ?? []), ...(state.delivery ? [state.delivery] : [])], delivery: {approval: plan.fingerprint, selected: plan.selected, outcomes: plan.operations.map(operation => completedOutcome(state, operation) ?? {caseId: operation.caseId, operationId: operation.identity, approval: plan.fingerprint, status: 'pending', adoId: operation.adoId, requestFingerprint: requestFingerprint(operation)})}});
    const saveOutcome = (index, change) => {state.delivery.outcomes[index] = {...state.delivery.outcomes[index], ...change}; const outcome = state.delivery.outcomes[index]; if (outcome.status === 'applied' && outcome.caseId.startsWith('NEW-')) state.created[outcome.caseId] = outcome.adoId; state = saveDesignState(roots, designId, state);};
    for (const [index, operation] of plan.operations.entries()) {
      if (['applied', 'unchanged'].includes(state.delivery.outcomes[index].status)) continue;
      try {
        requireReviewed(state, [operation.caseId], roots);
        await requireFreshDesign(roots, state, {...options, selected: [operation.caseId]});
        // Recheck the relevant case revision and permission immediately before dispatch.
        const current = await currentOperation(client, state, operation);
        requireThat(fingerprint(current) === fingerprint(operation), 'Case changed immediately before dispatch.');
        if (!operation.request) {await verifyCaseOperation(client, operation, operation.adoId); saveOutcome(index, {status: 'unchanged', revision: operation.revision}); continue;}
        const delivery = client.delivery('case-design', true, plan.fingerprint);
        saveOutcome(index, {status: 'dispatching', receipt: delivery.receipt});
        let item;
        try {
          item = await delivery.write(operation.adoId ? 'edit-case' : 'create-case', operation.request.route, operation.request.body, {method: operation.request.method, patch: true,
            onIdentity(identity) {saveOutcome(index, {adoId: identity.workItemId});}});
        } catch (error) {saveOutcome(index, {status: error.delivery?.effect === 'not-executed' ? 'failed' : 'uncertain', reason: 'Dispatch was not verified. Reconcile the durable receipt before continuing.'}); return result(roots, state);}
        const remoteId = adoId(item.id); saveOutcome(index, {adoId: remoteId, status: 'uncertain'});
        const verified = await verifyCaseOperation(client, operation, remoteId);
        delivery.verified({workItemId: remoteId, revision: verified.rev}); delivery.finish();
        saveOutcome(index, {status: 'applied', revision: verified.rev, url: `${plan.destination.organizationUrl}/${encodeURIComponent(plan.destination.project)}/_workitems/edit/${remoteId}`});
      } catch (error) {
        const status = ['dispatching', 'uncertain'].includes(state.delivery.outcomes[index].status) ? 'uncertain' : 'failed';
        saveOutcome(index, {status, reason: error.delivery ? 'Unverified delivery; inspect receipt.' : error.code ? 'Local receipt or IO failed.' : error.message}); return result(roots, state);
      }
    }
    return result(roots, state);
  } finally {release();}
}

function receiptIdentity(roots, outcome, operation, approval) {
  if (!outcome.receipt) return null;
  const bytes = readFileSync(consumerPath(roots, outcome.receipt), 'utf8'); requireThat(Buffer.byteLength(bytes) <= 2 * 1024 * 1024, 'Receipt exceeds bound.');
  const events = bytes.trim().split('\n').map(line => JSON.parse(line));
  requireThat(events[0]?.event === 'authorized' && events[0].sourceFingerprint === approval && events[0].kind === 'case-design', 'Receipt does not match this approved delivery.');
  const expected = adoRequestFingerprint(operation.request.route, operation.request.method, operation.request.body);
  requireThat(events.some(event => event.event === 'prepared' && event.requestFingerprint === expected) && events.filter(event => event.requestFingerprint).every(event => event.requestFingerprint === expected), 'Receipt request fingerprint differs from approved intent.');
  return events.find(event => event.event === 'acknowledged')?.identity?.workItemId ?? outcome.adoId;
}
export async function reconcileDesign(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    let state = readDesign(roots, designId); requireThat(state?.delivery, 'No design delivery to reconcile.');
    const plan = readPlan(roots, designId, state.delivery.approval); requireBinding(state, plan);
    const client = requirementsClient(roots, options), project = await destination(client, plan);
    for (const [index, operation] of plan.operations.entries()) {
      const outcome = state.delivery.outcomes[index];
      if (['pending', 'failed'].includes(outcome.status)) continue;
      try {
        let candidates = outcome.adoId ? [outcome.adoId] : [];
        if (operation.request && outcome.receipt) {const found = receiptIdentity(roots, outcome, operation, outcome.approval ?? plan.fingerprint); if (found) candidates = [found];}
        if (!candidates.length) {
          const story = await client.read(`wit/workitems/${plan.destination.storyId}?$expand=relations&api-version=7.1`); await client.requireWorkItemProject(story);
          candidates = [...new Set((story.relations ?? []).filter(relation => relation.rel === 'Microsoft.VSTS.Common.TestedBy-Forward').map(relation => workItemLinkId(relation.url, client.configuration.organizationUrl, project)).filter(Boolean))];
          requireThat(candidates.length <= 500, 'Recovery candidates exceed selected-story bounds.');
        }
        const matched = [];
        for (const candidate of candidates) {
          try {matched.push(await verifyCaseOperation(client, operation, candidate, {historical: true}));} catch { /* An unproven candidate cannot establish an operation identity. */ }
        }
        requireThat(matched.length === 1, 'No unique exact operation/history/payload match. Preserve uncertainty; never recreate by title.');
        const item = matched[0]; state.delivery.outcomes[index] = {...outcome, status: operation.request ? 'applied' : 'unchanged', adoId: item.id, revision: item.rev, url: `${plan.destination.organizationUrl}/${encodeURIComponent(plan.destination.project)}/_workitems/edit/${item.id}`, reconciled: true};
        if (operation.request && outcome.caseId.startsWith('NEW-')) state.created[outcome.caseId] = item.id;
      } catch (error) {state.delivery.outcomes[index] = {...outcome, status: 'uncertain', reason: error.code ? 'Recovery read failed.' : error.message};}
      state = saveDesignState(roots, designId, state);
    }
    // Recovery proves past effects even when referenced rules now require revalidation.
    const referenceFreshness = [];
    for (const reference of state.evidence.references?.items ?? []) {
      if (reference.classification === 'incidental' || !reference.source || !reference.requirementIds.length) continue;
      try {await requireFreshReferences(roots, {...state, evidence: {...state.evidence, references: {...state.evidence.references, items: [reference]}}}, {client});}
      catch (error) {referenceFreshness.push({referenceId: reference.id, requirementIds: reference.requirementIds, caseIds: state.draft.cases.filter(row => row.coverageReferences.some(ref => reference.requirementIds.includes(ref.requirementId))).map(row => row.id), status: 'stale-or-unavailable', reason: error.code ? 'Referenced evidence is unavailable; refresh and revalidate.' : error.message});}
    }
    state = saveDesignState(roots, designId, {...state, referenceFreshness});
    return result(roots, state);
  } finally {release();}
}
