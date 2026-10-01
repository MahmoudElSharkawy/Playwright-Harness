import {requireAssessedResult} from '../execution-core/index.mjs';
import {data, frozen, fingerprint, requireThat} from '../execution-core/data.mjs';

const VIEWS = new WeakSet();
function output(value) {
  const text = value.sensitivity === 'sensitive' ? '[redacted]' : JSON.stringify(value.value);
  return {name: value.name, type: value.type, sensitivity: value.sensitivity, producer: value.producer,
    display: text.length > 4096 ? text.slice(0, 4096) + '… [truncated]' : text, truncated: text.length > 4096};
}

/** Project already-decided verdicts. Never infer status from HTTP codes, counts or cleanup. */
export function reportView(input) {
  const result = requireAssessedResult(input);
  const content = data({version: 1, kind: 'validated-execution', runId: result.runId, inputFingerprint: result.inputFingerprint,
    status: result.status, stability: result.stability, counts: result.counts,
    scenarios: result.scenarios.map(scenario => ({id: scenario.id, status: scenario.status, stability: scenario.stability,
      disposition: scenario.disposition, ...(scenario.reason ? {reason: scenario.reason} : {}), counts: scenario.counts, issues: scenario.issues,
      ...(scenario.requiredLifecycleComplete !== undefined ? {requiredLifecycleComplete: scenario.requiredLifecycleComplete} : {}),
      attempts: scenario.attempts.map(attempt => ({identity: attempt.identity, operationFingerprint: attempt.operationFingerprint,
        startedAt: attempt.startedAt, endedAt: attempt.endedAt, durationMs: attempt.endedAt - attempt.startedAt,
        outcome: attempt.outcome, failureClass: attempt.failureClass, effect: attempt.effect,
        ...(attempt.reconciliation ? {reconciliation: {kind: attempt.reconciliation.kind, evidenceIds: attempt.reconciliation.evidenceIds}} : {}),
        assertions: attempt.assertions, evidenceIds: attempt.evidenceIds})),
      resources: scenario.resources.map(resource => ({id: resource.id, originAttemptId: resource.originAttemptId,
        identity: resource.identity, ownership: resource.ownership, intent: resource.intent, lifecycle: resource.lifecycle,
        restorationData: resource.beforeStateRef ? 'protected' : 'not captured'})), outputs: scenario.outputs.map(output)})),
    operations: result.operations.map(operation => ({id: operation.id, family: operation.family, target: operation.target,
      capability: operation.capability, source: operation.source, fingerprint: operation.fingerprint})), evidence: result.evidence});
  const view = frozen({...content, fingerprint: fingerprint(content)}); VIEWS.add(view); return view;
}

export function requireView(view) {requireThat(VIEWS.has(view), 'Use a validated reporting view.'); return view;}
