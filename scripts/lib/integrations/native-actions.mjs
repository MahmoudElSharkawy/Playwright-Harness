import {consumerPath} from '../consumer-paths.mjs';
import {requireValue} from './config.mjs';
import {writeJson, readOptional} from '../execute/storage.mjs';
import {withTransition} from '../execute/lock.mjs';
import {fingerprint} from '../execution-core/data.mjs';
import {deliveryProgress, requestFingerprint} from './delivery.mjs';

/** One approved batch: recover verified effects, resume only proven undispatched requests. */
export async function nativeActions(roots, {kind, binding, input, execute, approval, prepare, delivery, write, verify, completion, results, lockOptions = {}}) {
  const inputFingerprint = fingerprint({binding, input}), path = `.harness/state/integrations/compat-${kind}-${inputFingerprint}.json`;
  const activePath = `.harness/state/integrations/compat-${kind}-${fingerprint(binding)}-active.json`;
  async function run() {
    const active = readOptional(consumerPath(roots, activePath));
    if (active && active.inputFingerprint !== inputFingerprint) {
      requireValue(typeof active.path === 'string' && /^\.harness\/state\/integrations\/compat-[a-z-]+-[a-f0-9]{64}\.json$/.test(active.path), 'Invalid active native batch.');
      requireValue(readOptional(consumerPath(roots, active.path), 16 * 1024 * 1024)?.state === 'COMPLETED', 'Reconcile the prior native batch before approving a different operation.');
    }
    let row = readOptional(consumerPath(roots, path), 16 * 1024 * 1024);
    if (row) requireValue(row.version === 1 && row.inputFingerprint === inputFingerprint && fingerprint(row.plan) === row.approval, 'Stored native approval or plan changed.');
    const plan = row?.plan ?? {version: 1, kind, binding, inputFingerprint, plans: await prepare()}, approved = fingerprint(plan);
    const preview = {...plan, mode: 'dry-run', fingerprint: approved};
    if (!execute) return preview;
    requireValue(approval === approved, 'Execute needs --approval matching the exact reviewed preview fingerprint.');
    if (!row) {row = {version: 1, inputFingerprint, approval: approved, plan, state: 'INTENT', identities: [], completed: [], receipts: []}; writeJson(consumerPath(roots, path), row, {exclusive: true, maximum: 16 * 1024 * 1024, maxNodes: 200000});}
    writeJson(consumerPath(roots, activePath), {inputFingerprint, path});
    const save = () => writeJson(consumerPath(roots, path), row, {maximum: 16 * 1024 * 1024, maxNodes: 200000});
    if (results) return results({row, save, plan: plan.plans[0], approved, preview});
    if (row.state !== 'INTENT') {
      let recovery;
      try {
        const pending = [];
        for (const [index, item] of plan.plans.entries()) {
          let complete = false; try {await verify(item); complete = true;} catch {}
          if (complete) {row.completed = [...new Set([...(row.completed ?? []), index])]; continue;}
          const remaining = completion ? await completion(item) : {requests: item.requests};
          requireValue(remaining.requests.length > 0, 'Native action is incomplete without a recoverable request.');
          pending.push({index, item, requests: remaining.requests});
        }
        if (pending.length) {
          const receipts = [...new Set([...(row.receipts ?? []), ...(row.receipt ? [row.receipt] : [])])], progress = deliveryProgress(roots, receipts, {sourceFingerprint: approved, kind});
          for (const part of pending) for (const request of part.requests) {
            const route = request.channel ? `${request.channel}/${request.route}` : request.route, prior = progress.get(requestFingerprint(route, request.method, request.body));
            requireValue(!prior || !prior.confirmed && (!prior.dispatched || prior.rejected), 'A missing effect was already dispatched; preserve uncertainty rather than repeat it.');
          }
          recovery = delivery(approved); row.receipts = [...receipts, recovery.receipt]; save();
          for (const part of pending) {
            if (!completion) await write(part.item, recovery);
            else for (const request of part.requests) await recovery.write(request.operation, request.channel ? `${request.channel}/${request.route}` : request.route, request.body, {method: request.method});
            await verify(part.item); recovery.verified({workItemId: part.item.id}); row.completed = [...new Set([...(row.completed ?? []), part.index])]; save();
          }
          recovery.finish();
        }
        row.state = 'COMPLETED'; save(); return {...preview, mode: 'resumed', receipt: recovery?.receipt ?? row.receipt};
      } catch {row.state = 'UNCERTAIN'; save(); return {...preview, mode: 'reconciliation-required', receipt: recovery?.receipt ?? row.receipt, detail: 'Stored native batch is incomplete or changed; unresolved dispatched effects are never repeated.'};}
    }
    const receipt = delivery(approved); row.receipt = receipt.receipt; row.receipts = [receipt.receipt]; row.state = 'DISPATCHING'; save();
    try {
      for (const [index, item] of plan.plans.entries()) {await write(item, receipt); await verify(item); receipt.verified({workItemId: item.id}); row.completed.push(index); save();}
      receipt.finish(); row.state = 'COMPLETED'; save(); return {...preview, mode: 'execute', receipt: row.receipt};
    } catch {row.state = 'UNCERTAIN'; save(); return {...preview, mode: 'reconciliation-required', receipt: row.receipt, detail: 'Native batch was not fully verified. Re-execute the same approval to read back effects and complete only proven undispatched requests.'};}
  }
  return execute ? withTransition(roots, run, {...lockOptions, key: `compat-${kind}-${fingerprint(binding).slice(0, 32)}`}) : run();
}
