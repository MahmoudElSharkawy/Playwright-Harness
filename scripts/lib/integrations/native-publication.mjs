import {requireThat} from '../execution-core/data.mjs';
import {externalIdentity, deliveryProgress, requireUndispatched} from './delivery.mjs';
import {writeRequest} from './test-management-common.mjs';

function completeIdentities(plan, identities) {
  const ids = plan.desired.map(row => row.caseId);
  requireThat(ids.length > 0 && ids.length <= 500 && new Set(ids).size === ids.length && Array.isArray(identities) && identities.length === ids.length && new Set(identities.map(row => row.caseId)).size === ids.length
    && new Set(identities.map(row => String(row.id))).size === ids.length && identities.every(row => ids.includes(row.caseId) && externalIdentity(row.id)), 'Native result identities do not cover the approved case scope.');
  return identities;
}

/** Shared result write/recovery lifecycle; callers persist the exact approved source-bound plan first. */
export async function deliverNativeResults(management, {roots, row, save, plan, approved, preview}) {
  if (row.state === 'COMPLETED') {completeIdentities(plan, row.identities); return {...preview, mode: 'resumed', identities: row.identities};}
  if (row.state !== 'INTENT') {
    try {
      row.identities = completeIdentities(plan, await management.reconcileResults(plan, row.identities)); row.state = 'COMPLETED'; save();
      return {...preview, mode: 'resumed', identities: row.identities};
    } catch {
      if (roots && management.findResults) try {
        const found = await management.findResults(plan, row.identities), missing = plan.desired.map((item, index) => ({item, index})).filter(({item}) => !found.some(value => value.caseId === item.caseId));
        const completion = management.resultCompletion ? await management.resultCompletion(plan) : {requests: missing.map(({index}) => plan.requests[index])};
        requireUndispatched(completion.requests, deliveryProgress(roots, [row.receipt, ...(row.recoveryReceipts ?? [])], {sourceFingerprint: approved, kind: 'outcomes'}));
        const delivery = management.delivery('outcomes', true, approved);
        row.recoveryReceipts = [...(row.recoveryReceipts ?? []), delivery.receipt]; row.identities = found; row.state = 'DISPATCHING'; save();
        if (management.resultCompletion) {
          for (const request of completion.requests) await writeRequest(delivery, request);
          row.identities = completeIdentities(plan, await management.verifyResults(plan));
        } else {
          const subset = {...plan, desired: missing.map(({item}) => item), requests: completion.requests};
          const identities = await management.writeResults(subset, delivery, {onIdentity(identity) {
            requireThat(subset.desired.some(item => item.caseId === identity.caseId) && externalIdentity(identity.id), 'Recovered native identity is outside the approved scope.');
            row.identities = row.identities.filter(value => value.caseId !== identity.caseId); row.identities.push(identity); save();
          }});
          row.identities = completeIdentities(plan, [...found, ...identities]); await management.verifyResults(plan, row.identities);
        }
        for (const identity of row.identities) delivery.verified({resultId: identity.id});
        delivery.finish(); row.state = 'COMPLETED'; save(); return {...preview, mode: 'resumed', identities: row.identities};
      } catch {row.state = 'UNCERTAIN'; save();}
      return {...preview, mode: 'reconciliation-required', receipt: row.receipt, detail: 'Native results are incomplete or uncertain. Reconcile the stored plan before another delivery.'};
    }
  }
  const delivery = management.delivery('outcomes', true, approved); row.receipt = delivery.receipt; row.state = 'DISPATCHING'; save();
  try {
    const identities = completeIdentities(plan, await management.writeResults(plan, delivery, {onIdentity(identity) {
      requireThat(plan.desired.some(item => item.caseId === identity.caseId) && externalIdentity(identity.id), 'Acknowledged native result is outside the approved scope.');
      row.identities = row.identities.filter(value => value.caseId !== identity.caseId); row.identities.push(identity); save();
    }}));
    row.identities = identities; save(); await management.verifyResults(plan, identities);
    for (const identity of identities) delivery.verified({resultId: identity.id});
    delivery.finish(); row.state = 'COMPLETED'; save(); return {...preview, mode: 'execute', identities};
  } catch {row.state = 'UNCERTAIN'; save(); return {...preview, mode: 'reconciliation-required', receipt: row.receipt, detail: 'Result delivery is incomplete. Read back the stored native identities/marker before another write.'};}
}
