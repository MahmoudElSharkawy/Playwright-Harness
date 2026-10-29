import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {readBounded, writeJson} from '../execute/storage.mjs';
import {requestFingerprint as nativeRequestFingerprint, deliveryProgress, requireUndispatched} from '../integrations/delivery.mjs';
import {createDesignTarget, operationRequestFingerprint as requestFingerprint, outcomeId, operationId} from './provider.mjs';
import {readDesign, lockDesign, saveDesignState, designPath, requireReviewed} from './index.mjs';
import {requireFreshDesign} from './sources.mjs';
import {requireFreshReferences} from './references.mjs';
import {coverage, renderDesign, preparationSteps, confirmedOutcomes} from './review.mjs';

function planContent(plan) {const {fingerprint: approved, ...content} = plan; requireThat(/^[a-f0-9]{64}$/.test(approved) && fingerprint(content) === approved, 'Saved approval plan changed; inspect the original immutable preview.'); return plan;}
function readPlan(roots, designId, approval) {requireThat(typeof approval === 'string' && /^[a-f0-9]{64}$/.test(approval), 'Publication requires the exact preview approval fingerprint.'); const plan = planContent(readBounded(designPath(roots, designId, `previews/${approval}.json`))); requireThat(plan.fingerprint === approval, 'Saved preview no longer matches the approved identity.'); return plan;}
function result(roots, state, delivery = state.delivery) {
  const outcomes = delivery.outcomes;
  return {mode: outcomes.every(row => ['applied', 'unchanged'].includes(row.status)) ? 'completed' : outcomes.some(row => row.status === 'uncertain') ? 'reconciliation-required' : 'incomplete', approval: delivery.approval, outcomes, coverage: coverage(state, undefined, {confirmed: true, roots}), execution: 'not-run'};
}
function requireBinding(state, plan) {
  requireThat(state.proposal === plan.proposal && state.source === plan.source && state.assessment === plan.assessment && state.consumer === plan.consumer && (state.approvalGeneration ?? 0) === (plan.approvalGeneration ?? 0), 'Proposal, source, assessment, approval generation or consumer changed; obtain renewed approval.');
}
const completedOutcome = (state, operation) => confirmedOutcomes(state).find(row => row.caseId === operation.caseId && row.operationId === operation.identity && row.requestFingerprint === requestFingerprint(operation));
function destination(target, plan) {requireThat(fingerprint(target.destination) === fingerprint(plan.destination), 'Configured destination changed; obtain renewed approval.');}
async function makePlan(roots, state, options) {
  const selected = requireReviewed(state, options.selected, roots);
  requireThat(state.evidence.requirements.origin, 'Local design uses handoff; publication requires a captured originating story and configured access.');
  await requireFreshDesign(roots, state, {...options, selected});
  const target = await createDesignTarget(roots, state.evidence.requirements.origin, options);
  const operations = [], confirmed = [];
  for (const id of selected) {
    const outcome = confirmedOutcomes(state).find(row => row.caseId === id);
    if (outcome) {
      const approved = readPlan(roots, state.id, outcome.approval); requireBinding(state, approved);
      const operation = approved.operations.find(row => row.caseId === id);
      requireThat(operation && completedOutcome(state, operation), 'Confirmed operation no longer matches its approved intent.');
      await target.verify(operation, outcomeId(outcome), {historical: true});
      operations.push(operation); confirmed.push({caseId: id, ...(outcome.adoId ? {adoId: outcome.adoId} : outcome.externalId ? {externalId: outcome.externalId} : {local: true}), status: outcome.status});
    } else {
      requireThat(!state.created[id], 'This temporary ID was already created; refresh and use its returned native ID.');
      operations.push(await target.prepare(state, state.draft.cases.find(row => row.id === id)));
    }
  }
  const plan = {version: 1, consumer: state.consumer, source: state.source, proposal: state.proposal, assessment: state.assessment, approvalGeneration: state.approvalGeneration ?? 0, selected, confirmed,
    destination: target.destination, operations,
    coverage: coverage(state, selected, {roots}), rendered: renderDesign(state.draft), preparationPreview: selected.map(id => ({caseId: id, steps: preparationSteps(state.draft.cases.find(row => row.id === id), state.draft.preparations.find(row => row.caseId === id))})), note: target.local ? 'Approved cases remain local. Handoff supplies the existing execution and automation flows with Jira story links.' : target.destination.provider === 'jira' ? 'Native case content and story links are verified after publishing. An owned operation marker supports recovery; incomplete writes are never blindly replayed.' : 'Creation links to the story atomically. Native History records a per-operation recovery marker. Existing unrelated Description, tags and relationships are preserved. Validate-only requests check fields, rules and permissions; they do not publish cases.'};
  return {...plan, fingerprint: fingerprint(plan)};
}
export async function previewDesign(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    const state = readDesign(roots, designId); requireThat(!state?.delivery || state.delivery.outcomes.every(row => ['applied', 'unchanged', 'failed'].includes(row.status)), 'Reconcile unfinished delivery before another preview.');
    const plan = await makePlan(roots, state, options), path = designPath(roots, designId, `previews/${plan.fingerprint}.json`);
    if (!existsSync(path)) writeJson(path, plan, {exclusive: true, maxNodes: 500000}); return plan;
  } finally {release();}
}

export async function publishDesign(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    let state = readDesign(roots, designId); const plan = readPlan(roots, designId, options.approval); requireBinding(state, plan);
    const target = await createDesignTarget(roots, state.evidence.requirements.origin, options); destination(target, plan);
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
      if (completed) {await target.verify(operation, outcomeId(completed), {historical: true}); continue;}
      requireThat(!state.created[operation.caseId], 'This temporary ID was already created; refresh and use its returned native ID.');
      const current = await target.prepare(state, state.draft.cases.find(row => row.id === operation.caseId));
      requireThat(fingerprint(current) === fingerprint(operation), 'Native request changed; review and approve a new preview.');
    }
    if (state.delivery?.approval !== plan.fingerprint) state = saveDesignState(roots, designId, {...state, deliveryHistory: [...(state.deliveryHistory ?? []), ...(state.delivery ? [state.delivery] : [])], delivery: {approval: plan.fingerprint, selected: plan.selected, outcomes: plan.operations.map(operation => completedOutcome(state, operation) ?? {caseId: operation.caseId, operationId: operation.identity, approval: plan.fingerprint, status: 'pending', ...(operation.externalId ? {externalId: operation.externalId} : operation.adoId !== undefined ? {adoId: operation.adoId} : {}), requestFingerprint: requestFingerprint(operation)})}});
    const saveOutcome = (index, change) => {state.delivery.outcomes[index] = {...state.delivery.outcomes[index], ...change}; const outcome = state.delivery.outcomes[index]; if (outcome.status === 'applied' && outcome.caseId.startsWith('NEW-') && !operationId(plan.operations[index]) && outcomeId(outcome)) state.created[outcome.caseId] = outcomeId(outcome); state = saveDesignState(roots, designId, state);};
    for (const [index, operation] of plan.operations.entries()) {
      if (['applied', 'unchanged'].includes(state.delivery.outcomes[index].status)) continue;
      try {
        requireReviewed(state, [operation.caseId], roots);
        await requireFreshDesign(roots, state, {...options, selected: [operation.caseId]});
        // Recheck the relevant case revision and permission immediately before dispatch.
        const current = await target.prepare(state, state.draft.cases.find(row => row.id === operation.caseId));
        requireThat(fingerprint(current) === fingerprint(operation), 'Case changed immediately before dispatch.');
        if (!operation.request) {const item = await target.verify(operation, operationId(operation)); saveOutcome(index, {status: 'unchanged', ...target.outcome(item)}); continue;}
        const delivery = target.delivery(plan.fingerprint);
        saveOutcome(index, {status: 'dispatching', receipt: delivery.receipt});
        let remoteId;
        try {
          remoteId = await target.write(operation, delivery, identity => saveOutcome(index, identity));
        } catch (error) {
          let effected = error.delivery?.effect !== 'not-executed';
          if (operation.nativePlan && !effected) {
            try {effected = [...deliveryProgress(roots, [delivery.receipt], {sourceFingerprint: plan.fingerprint, kind: 'case-design'}).values()].some(row => row.confirmed || row.dispatched && !row.rejected);}
            catch {effected = true;}
          }
          saveOutcome(index, {status: effected ? 'uncertain' : 'failed', reason: 'Dispatch was not verified. Reconcile the durable receipt before continuing.'}); return result(roots, state);
        }
        saveOutcome(index, {...(operation.nativePlan ? {externalId: remoteId} : {adoId: remoteId}), status: 'uncertain'});
        const verified = await target.verify(operation, remoteId);
        delivery.verified(target.verified(verified)); delivery.finish();
        saveOutcome(index, {status: 'applied', ...target.outcome(verified)});
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
  if (operation.nativePlan) {
    const expected = operation.nativePlan.requests.map(request => nativeRequestFingerprint(`${request.channel}/${request.route}`, request.method, request.body));
    requireThat(events.some(event => event.event === 'prepared' && expected.includes(event.requestFingerprint)), 'Receipt request fingerprint differs from approved native intent.');
    return events.find(event => event.event === 'acknowledged' && expected.includes(event.requestFingerprint) && typeof event.identity?.externalId === 'string' && /-[A-Z]*[1-9]\d*$/.test(event.identity.externalId))?.identity.externalId ?? outcome.externalId;
  }
  const expected = requestFingerprint(operation);
  requireThat(events.some(event => event.event === 'prepared' && event.requestFingerprint === expected) && events.filter(event => event.requestFingerprint).every(event => event.requestFingerprint === expected), 'Receipt request fingerprint differs from approved intent.');
  return events.find(event => event.event === 'acknowledged')?.identity?.workItemId ?? outcome.adoId;
}
export async function reconcileDesign(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    let state = readDesign(roots, designId); requireThat(state?.delivery, 'No design delivery to reconcile.');
    const plan = readPlan(roots, designId, state.delivery.approval); requireBinding(state, plan);
    const target = await createDesignTarget(roots, state.evidence.requirements.origin, options); destination(target, plan);
    for (const [index, operation] of plan.operations.entries()) {
      const outcome = state.delivery.outcomes[index];
      if (['pending', 'failed'].includes(outcome.status)) continue;
      try {
        if (target.local) continue;
        let candidates = outcomeId(outcome) ? [outcomeId(outcome)] : [];
        if (operation.request && outcome.receipt) {const found = receiptIdentity(roots, outcome, operation, outcome.approval ?? plan.fingerprint); if (found) candidates = [found];}
        if (!candidates.length) {
          candidates = await target.candidates(operation);
        }
        const matched = [];
        for (const candidate of candidates) {
          try {matched.push(await target.verify(operation, candidate, {historical: true}));} catch { /* An unproven candidate cannot establish an operation identity. */ }
        }
        if (!matched.length && operation.nativePlan && candidates.length === 1 && options.execute === true) {
          requireThat(options.approval === plan.fingerprint, 'Completing missing native operations requires the original exact approval.');
          requireReviewed(state, [operation.caseId], roots);
          await requireFreshDesign(roots, state, {...options, selected: [operation.caseId]});
          const completion = await target.completion(operation, candidates[0]);
          const receipts = [outcome.receipt, ...(outcome.recoveryReceipts ?? [])];
          const progress = deliveryProgress(roots, receipts, {sourceFingerprint: plan.fingerprint, kind: 'case-design'});
          requireUndispatched(completion.requests, progress);
          if (completion.requests.length) {
            const delivery = target.delivery(plan.fingerprint);
            outcome.recoveryReceipts = [...(outcome.recoveryReceipts ?? []), delivery.receipt]; outcome.externalId = candidates[0];
            state.delivery.outcomes[index] = outcome; state = saveDesignState(roots, designId, state);
            const verified = await target.complete(operation, candidates[0], completion.requests, delivery);
            delivery.verified(target.verified(verified)); delivery.finish(); matched.push(verified);
          } else matched.push(await target.verify(operation, candidates[0], {historical: true}));
        }
        requireThat(matched.length === 1, 'No unique exact operation/history/payload match. Preserve uncertainty; never recreate by title.');
        const item = matched[0]; state.delivery.outcomes[index] = {...outcome, status: operation.request ? 'applied' : 'unchanged', ...target.outcome(item), reconciled: true};
        if (operation.request && outcome.caseId.startsWith('NEW-') && !operationId(operation)) state.created[outcome.caseId] = item.id;
      } catch (error) {state.delivery.outcomes[index] = {...outcome, status: 'uncertain', reason: error.code ? 'Recovery read failed.' : error.message};}
      state = saveDesignState(roots, designId, state);
    }
    // Recovery proves past effects even when referenced rules now require revalidation.
    const referenceFreshness = [];
    for (const reference of state.evidence.references?.items ?? []) {
      if (reference.classification === 'incidental' || !reference.source || !reference.requirementIds.length) continue;
      try {await requireFreshReferences(roots, {...state, evidence: {...state.evidence, references: {...state.evidence.references, items: [reference]}}}, {client: target.client});}
      catch (error) {referenceFreshness.push({referenceId: reference.id, requirementIds: reference.requirementIds, caseIds: state.draft.cases.filter(row => row.coverageReferences.some(ref => reference.requirementIds.includes(ref.requirementId))).map(row => row.id), status: 'stale-or-unavailable', reason: error.code ? 'Referenced evidence is unavailable; refresh and revalidate.' : error.message});}
    }
    state = saveDesignState(roots, designId, {...state, referenceFreshness});
    return result(roots, state);
  } finally {release();}
}
