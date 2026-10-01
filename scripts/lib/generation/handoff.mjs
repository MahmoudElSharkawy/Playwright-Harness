import {validateLocalSource} from '../local-source.mjs';
import {assessRun} from '../execution-core/index.mjs';
import {data, fingerprint, frozen, keys, requireThat, unique} from '../execution-core/data.mjs';
const HANDOFFS = new WeakSet();

/** Stable source positions retain the original text; observations never rewrite the oracle. */
export function sourceExpectations(source) {
  return source.scenarios.flatMap(scenario => scenario.steps.flatMap((step, stepIndex) => step.expected.map((expected, expectedIndex) => ({
    key: `expect-${fingerprint([scenario.id, stepIndex, expectedIndex]).slice(0, 24)}`,
    scenarioId: scenario.id, step: stepIndex + 1, expected: expectedIndex + 1, action: step.action, description: expected
  }))));
}

/** Reassess actual artifacts, not an agent's claimed verdict. No host, catalog or ADO dependency. */
export function createGenerationHandoff(sourceInput, executions, bindings) {
  const source = validateLocalSource(sourceInput), expectations = sourceExpectations(source);
  requireThat(Array.isArray(executions) && executions.length > 0, 'Generation needs observed execution.');
  const runs = executions.map(({run, roots, observations}) => {
    const result = assessRun(run, roots, observations);
    requireThat(['PASS', 'FAIL'].includes(result.status) && result.scenarios.every(s => s.requiredLifecycleComplete && !s.issues.length && s.stability !== 'unstable' && s.counts.evaluated === s.counts.required), 'Resolve indeterminate execution and lifecycle obligations before generation.');
    return {runId: run.id, inputFingerprint: run.inputFingerprint, status: result.status, stability: result.stability,
      scope: run.inputs.scenarios, operations: result.operations, scenarios: result.scenarios, evidence: result.evidence};
  });
  unique(runs.map(run => run.runId), 'observed runs');
  requireThat(Array.isArray(bindings) && bindings.length === expectations.length, 'Map every source expectation exactly once.');
  unique(bindings.map(binding => binding.key), 'source bindings');
  unique(bindings.map(binding => fingerprint([binding.runId, binding.scenarioId, binding.expectationId])), 'execution assertion bindings');
  for (const binding of bindings) {
    keys(binding, ['key', 'runId', 'scenarioId', 'expectationId'], 'source binding');
    requireThat(expectations.some(e => e.key === binding.key), 'Unknown source expectation.');
    const run = runs.find(r => r.runId === binding.runId), scenario = run?.scenarios.find(s => s.id === binding.scenarioId);
    const expected = run?.scope.find(s => s.id === binding.scenarioId)?.expectations.find(e => e.id === binding.expectationId);
    requireThat(expected && scenario?.attempts.some(a => a.assertions.some(e => e.id === binding.expectationId && e.reliable && ['PASS', 'FAIL'].includes(e.status))), 'A source assertion needs a reliably evaluated execution assertion.');
  }
  // Include identities, definitions and lifecycle facts, never raw response bodies or protected values.
  const observations = runs.map(run => ({runId: run.runId, inputFingerprint: run.inputFingerprint, status: run.status, stability: run.stability,
    scope: run.scope, operations: run.operations, evidence: run.evidence,
    scenarios: run.scenarios.map(s => ({id: s.id, status: s.status, stability: s.stability, counts: s.counts, resources: s.resources,
      attempts: s.attempts.map(a => ({identity: a.identity, operationFingerprint: a.operationFingerprint, outcome: a.outcome,
        effect: a.effect, assertions: a.assertions, evidenceIds: a.evidenceIds}))}))}));
  const content = data({version: 1, source, expectations, bindings, observations});
  const handoff = frozen({...content, fingerprint: fingerprint(content)}); HANDOFFS.add(handoff); return handoff;
}

export function validateHandoff(input) {
  requireThat(HANDOFFS.has(input), 'Create the handoff by assessing execution, not by importing a claimed verdict.');
  const {fingerprint: claimed, ...content} = data(input);
  keys(content, ['version', 'source', 'expectations', 'bindings', 'observations'], 'generation handoff');
  requireThat(content.version === 1 && fingerprint(content) === claimed, 'Generation handoff integrity mismatch.');
  validateLocalSource(content.source);
  requireThat(fingerprint(sourceExpectations(content.source)) === fingerprint(content.expectations), 'Source expectations were changed.');
  return frozen({...content, fingerprint: claimed});
}
