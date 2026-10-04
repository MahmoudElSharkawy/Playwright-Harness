import {attemptRecord} from '../execution-core/attempts.mjs';
import {validateResourceLifecycle} from '../execution-core/results.mjs';
import {data, requireThat, keys} from '../execution-core/data.mjs';

export function projectOutcome(attempt, failure) {
  if (attempt.assertions.some(item => item.status === 'FAIL' && item.reliable)) return {...attempt, outcome: 'ASSERTION_FAILURE', failureClass: 'ASSERTION'};
  return {...attempt, outcome: failure ? 'INFRASTRUCTURE_FAILURE' : 'SUCCESS', failureClass: failure?.classification ?? (failure ? 'EXECUTOR' : 'NONE')};
}

/** Validate the entire candidate before replacing any live attempt or resource field. */
export function prepareSettlement(run, scenario, evidence, current, staged, failure) {
  const input = data(staged);
  keys(input, ['assertions', 'outputs', 'effect', 'reconciliation', 'resources', 'lifecycles', 'retry'], 'browser settlement');
  const candidate = projectOutcome({...data(current), assertions: input.assertions, outputs: input.outputs ?? [], effect: input.effect,
    ...(input.reconciliation ? {reconciliation: input.reconciliation} : {}), endedAt: Date.now()}, failure);
  const checked = attemptRecord(run, candidate), ids = new Set(current.evidenceIds), artifacts = new Map(evidence.map(item => [item.id, item]));
  for (const reference of [...checked.assertions.flatMap(item => item.evidenceIds), ...(checked.reconciliation?.evidenceIds ?? [])]) requireThat(ids.has(reference) && artifacts.has(reference), 'Settlement evidence belongs to this attempt.');
  const resources = data(scenario.resources);
  for (const resource of input.resources ?? []) {
    requireThat(!resources.some(item => item.id === resource.id), 'Resource identity already exists.');
    resources.push({...resource, originAttemptId: current.identity.attemptId});
  }
  for (const {resourceId, update} of input.lifecycles ?? []) {
    const resource = resources.find(item => item.id === resourceId);
    requireThat(resource && resourceId !== 'owned-browser-session' && resource.originAttemptId !== current.identity.attemptId && ['CLEANUP', 'RESTORE'].includes(current.identity.phase), 'Lifecycle update needs an existing business resource and cleanup/restoration attempt.');
    keys(update, ['status', 'evidenceIds', 'guard'], 'lifecycle update');
    requireThat(['pending', 'failed', 'conflict'].includes(resource.lifecycle.status), 'Lifecycle is already completed.');
    resource.lifecycle = {...resource.lifecycle, ...update, attemptId: current.identity.attemptId};
  }
  const attempts = new Map([...scenario.attempts, checked].map(item => [item.identity.attemptId, item]));
  for (const resource of resources) validateResourceLifecycle(run, resource, attempts, artifacts);
  requireThat(!input.retry || checked.reconciliation?.kind === 'confirmed-no-effect', 'Manual retry needs confirmed no-effect reconciliation.');
  return {candidate: data(checked), resources, retry: input.retry === true};
}
