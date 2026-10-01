// Comparison only: execution, authorization and verdicts remain in the existing runtimes.
import {createRun, assessRun, authorizeOperation} from './execution-core/index.mjs';
import {fingerprint, requireThat} from './execution-core/data.mjs';

/** Revalidate artifacts locally before normalizing the explicit nondeterministic fields.
 * symbols identify producer slots, never arbitrary JSON keys or matching business strings.
 * Each symbol's slots must hold the same value; a changed binding remains a difference.
 */
export function executionSemantics({run: saved, observations, result, roots, symbols = []}) {
  const run = createRun({id: saved.id, startedAt: saved.startedAt, ...saved.inputs});
  requireThat(fingerprint(run) === fingerprint(saved), 'Frozen run changed.');
  const checked = assessRun(run, roots, observations);
  requireThat(fingerprint(checked) === fingerprint(result), 'Recorded verdict differs from validated observations.');
  const attempts = new Map(), resources = new Map(), slots = new Map(), evidence = new Map(checked.evidence.map(e => [e.id, e]));
  const key = p => JSON.stringify([p.scenarioId, p.attemptId === undefined ? 'initial' : attempts.get(p.attemptId), p.name]);
  for (const scenario of checked.scenarios) {
    for (const attempt of scenario.attempts) attempts.set(attempt.identity.attemptId, [scenario.id, attempt.identity.invocationId, attempt.identity.number]);
    scenario.resources.forEach((resource, index) => resources.set(JSON.stringify([scenario.id, resource.id]), [scenario.id, index]));
  }
  for (const value of [...run.inputs.values, ...checked.scenarios.flatMap(s => s.attempts.flatMap(a => a.outputs))]) slots.set(key(value.producer), value);
  const normalizedSlots = new Map(), names = new Set();
  for (const symbol of symbols) {
    requireThat(typeof symbol.name === 'string' && symbol.name.length > 0 && !names.has(symbol.name) && symbol.slots?.length > 0, 'Symbols need unique names and nonempty producer slots.'); names.add(symbol.name);
    let first;
    for (const slot of symbol.slots) {
      const slotKey = JSON.stringify([slot.scenarioId, slot.invocationId === undefined ? 'initial' : [slot.scenarioId, slot.invocationId, slot.number], slot.name]);
      const value = slots.get(slotKey);
      requireThat(value?.sensitivity === 'public' && ['string', 'number'].includes(value.type) && !normalizedSlots.has(slotKey), 'Symbol must identify a unique public scalar producer.');
      const actual = fingerprint({type: value.type, value: value.value}); first ??= actual;
      requireThat(actual === first, 'Generated identity correspondence changed its value.');
      normalizedSlots.set(slotKey, symbol.name);
    }
  }
  const coverage = ids => ids.map(id => {requireThat(evidence.has(id), 'Missing evidence.'); return evidence.get(id).kind;}).sort();
  const producer = p => ({scenarioId: p.scenarioId, attempt: p.attemptId === undefined ? null : attempts.get(p.attemptId), name: p.name});
  const value = v => ({name: v.name, type: v.type, sensitivity: v.sensitivity, producer: producer(v.producer),
    ...(normalizedSlots.has(key(v.producer)) ? {symbol: normalizedSlots.get(key(v.producer))} : v.sensitivity === 'public' ? {value: v.value} : {protectedRef: v.protectedRef})});
  const attemptRef = id => {requireThat(attempts.has(id), 'Missing attempt relationship.'); return attempts.get(id);};
  const resourceRef = (scenarioId, id) => {const key = JSON.stringify([scenarioId, id]); requireThat(resources.has(key), 'Missing resource relationship.'); return resources.get(key);};
  const env = run.inputs.environment;
  const operations = [...run.inputs.operations, ...observations.operations];
  // This proof permits ephemeral loopback ports. Remote destination, path, schema,
  // database and credential-reference changes remain meaningful differences.
  const localUrl = text => {const url = new URL(text); if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.port = ''; return url.href;};
  const targets = {api: Object.fromEntries(Object.entries(env.targets.api).map(([id, target]) => [id, {...target, baseUrl: localUrl(target.baseUrl)}])),
    databases: Object.fromEntries(Object.entries(env.targets.databases).map(([id, target]) => {
      const normalized = {...target}; if (['localhost', '127.0.0.1', '::1'].includes(target.server)) delete normalized.port; return [id, normalized];
    })), browser: Object.fromEntries(Object.entries(env.targets.browser).map(([id, target]) => [id, {...target, origins: target.origins.map(localUrl)}]))};
  return {
    scope: run.inputs.scenarios, environment: {name: env.name, mode: env.environmentMode, capabilities: env.capabilities,
      apiTargets: env.apiTargets, databaseTargets: env.databaseTargets, browserTargets: env.browserTargets ?? [],
      targets},
    limits: run.inputs.limits, knowledge: run.inputs.knowledge, operations, values: run.inputs.values.map(value),
    symbols, status: checked.status, stability: checked.stability, counts: checked.counts,
    scenarios: checked.scenarios.map(s => ({id: s.id, disposition: s.disposition, reason: s.reason ?? null, issues: s.issues,
      status: s.status, stability: s.stability, counts: s.counts, requiredLifecycleComplete: s.requiredLifecycleComplete ?? null,
      outputs: s.outputs.map(value), attempts: s.attempts.map(a => ({identity: {scenarioId: s.id, operationId: a.identity.operationId, invocationId: a.identity.invocationId, phase: a.identity.phase, number: a.identity.number},
        operationFingerprint: a.operationFingerprint, policy: authorizeOperation(run, operations.find(o => o.id === a.identity.operationId), a.supportedCapabilities),
        outcome: a.outcome, failureClass: a.failureClass, effect: {...a.effect, resourceIds: a.effect.resourceIds.map(id => resourceRef(s.id, id))},
        reconciliation: a.reconciliation ? {...a.reconciliation, evidenceIds: coverage(a.reconciliation.evidenceIds)} : null,
        inputs: a.inputs.map(value), outputs: a.outputs.map(value), supportedCapabilities: [...a.supportedCapabilities].sort(), evidence: coverage(a.evidenceIds),
        assertions: a.assertions.map(assertion => ({...assertion, evidenceIds: coverage(assertion.evidenceIds)}))})),
      resources: s.resources.map(r => ({id: resourceRef(s.id, r.id), origin: attemptRef(r.originAttemptId),
        identity: {name: r.identity.name, attempt: r.identity.attemptId === undefined ? null : attemptRef(r.identity.attemptId)},
        ownership: r.ownership, intent: r.intent, beforeStateRef: r.beforeStateRef ?? null,
        lifecycle: {...r.lifecycle, ...(r.lifecycle.attemptId ? {attemptId: attemptRef(r.lifecycle.attemptId)} : {}), evidenceIds: coverage(r.lifecycle.evidenceIds),
          ...(r.lifecycle.guard ? {guard: {...r.lifecycle.guard, evidenceIds: coverage(r.lifecycle.guard.evidenceIds)}} : {})}}))}))
  };
}

/** Expected case IDs are supplied by the reviewed proof, not inferred from two empty runs. */
export function compareExecutions(left, right, expected) {
  requireThat(Array.isArray(expected) && expected.length > 0 && new Set(expected).size === expected.length, 'Parity needs nonempty unique expected scope.');
  for (const cases of [left, right]) requireThat(Array.isArray(cases) && fingerprint(cases.map(c => c.id)) === fingerprint(expected), 'Missing, duplicate or reordered parity cases.');
  const cases = expected.map((id, index) => {
    const a = executionSemantics(left[index]), b = executionSemantics(right[index]);
    return {id, equivalent: fingerprint(a) === fingerprint(b), status: a.status, stability: a.stability,
      assertions: a.scenarios.reduce((n, s) => n + s.counts.required, 0), attempts: a.scenarios.reduce((n, s) => n + s.attempts.length, 0)};
  });
  return {status: cases.every(c => c.equivalent) ? 'PASS' : 'FAIL', cases};
}
