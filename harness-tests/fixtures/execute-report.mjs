/** Synthetic presentation inputs; no captured consumer execution data. */
export function executionReportView(statuses = ['PASS']) {
  const scenarios = statuses.map((status, index) => ({id: `tc-${index + 1}-r1`, caseId: index + 1, iteration: 1,
    title: `Case ${index + 1}`, status: status === 'INTEGRITY_FAILURE' || status === 'NOT_RUN' ? null : status,
    state: status === 'INTEGRITY_FAILURE' || status === 'NOT_RUN' ? status : 'ASSESSED', selectedRunId: status === 'INTEGRITY_FAILURE' || status === 'NOT_RUN' ? null : `run-${index + 1}`,
    history: [{runId: `run-${index + 1}`, state: status === 'INTEGRITY_FAILURE' || status === 'NOT_RUN' ? status : 'ASSESSED', verdict: status}],
    methods: {checked: 0, observed: 1, mixed: 0, unresolved: 0}}));
  const runs = scenarios.map(scenario => ({runId: `run-${scenario.caseId}`, scenarioId: scenario.id, state: scenario.state,
    conditions: [reportCondition(scenario.status === 'NEEDS_REVIEW' ? 'INDETERMINATE' : scenario.status ?? 'NOT_EVALUATED')], diagnostics: [],
    ...(scenario.state === 'ASSESSED' ? {result: {status: scenario.status, scenarios: [{resources: []}], evidence: []}} : {reason: 'No assessed verdict'})}));
  return {source: {title: 'Synthetic execution report', cases: [], excluded: []}, execution: {id: 'execute-fixture'}, scenarios, runs, revisionCheck: null};
}

export function reportCondition(status = 'PASS') {
  const condition = {id: 'condition-1', key: 'expect-1', index: 1, condition: {text: 'The expected panel is available', expected: null}};
  const record = {method: status === 'INDETERMINATE' ? 'unresolved' : 'observed', status, matching: true, invalidated: false,
    ...(status === 'INDETERMINATE' ? {reason: 'insufficient-evidence'} : {observed: status === 'FAIL' ? 'The expected panel is unavailable' : 'The panel is available', rationale: 'The recorded view supports this observation'}), evidenceIds: ['artifact-1']};
  return {...condition, status, method: record.method, evidenceIds: ['artifact-1'], provenance: {schema: 'execute-assertion/2', version: 2, contract: condition, results: [record], finalStateVersion: 1, status, method: record.method}};
}
