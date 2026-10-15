import {escapeHtml as h} from './text.mjs';
import {badge, outcome, caseOverview, renderOutcomeChart, renderCaseDocument} from './case-view.mjs';

const fields = entries => `<dl class="evidence-fields">${entries.map(([label, value]) => `<div class="evidence-field"><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>`;
const records = (title, rows) => rows.length ? `<details class="raw"><summary>${h(title)} · ${rows.length}</summary><div class="supporting-body">${rows.join('')}</div></details>` : '';
const joined = values => values.join(', ') || 'None recorded';

/** Sanitized assessed facts within a case, never a second report or new verdict. */
export function renderRuntimeEvidence(view) {
  const scenarios = view.scenarios.map(scenario => {
    const attempts = scenario.attempts.map(attempt => `<article class="comparison"><h4>${h(attempt.identity.phase)} · ${h(attempt.identity.operationId)}</h4>${fields([
      ['Attempt', `${attempt.identity.attemptId} (attempt ${attempt.identity.number})`], ['Invocation', attempt.identity.invocationId],
      ['Outcome', attempt.outcome], ['Classification', attempt.failureClass], ['Duration', `${attempt.durationMs} ms`],
      ['Effect', attempt.effect.certainty], ['Affected resources', joined(attempt.effect.resourceIds)],
      ['Operation fingerprint', attempt.operationFingerprint], ['Attempt evidence', joined(attempt.evidenceIds)],
      ...(attempt.effect.affectedRows ? [['Affected rows', JSON.stringify(attempt.effect.affectedRows)]] : []),
      ...(attempt.reconciliation ? [['Reconciliation', `${attempt.reconciliation.kind}; evidence ${joined(attempt.reconciliation.evidenceIds)}`]] : [])
    ])}${records('Assertions', attempt.assertions.map(assertion => fields([['Assertion', assertion.id], ['Status', assertion.status], ['Reliable', assertion.reliable], ['Evidence', joined(assertion.evidenceIds)]])))}</article>`);
    const resources = scenario.resources.map(resource => fields([
      ['Resource', resource.id], ['Ownership / intent', `${resource.ownership} / ${resource.intent}`],
      ['Lifecycle', `${resource.lifecycle.action} / ${resource.lifecycle.status}`], ['Restoration data', resource.restorationData],
      ['Origin', resource.originAttemptId], ['Identity', JSON.stringify(resource.identity)], ['Lifecycle attempt', resource.lifecycle.attemptId ?? 'None recorded'],
      ['Restoration guard', resource.lifecycle.guard ? `${resource.lifecycle.guard.kind}; evidence ${joined(resource.lifecycle.guard.evidenceIds)}` : 'Not required or not recorded'],
      ['Evidence', joined(resource.lifecycle.evidenceIds)]
    ]));
    const outputs = scenario.outputs.map(output => fields([['Output', output.name], ['Type / sensitivity', `${output.type} / ${output.sensitivity}`], ['Value', output.display], ['Producer', JSON.stringify(output.producer)]]));
    return `<p><strong>Stability:</strong> ${h(scenario.stability)} · <strong>Required lifecycle:</strong> ${scenario.requiredLifecycleComplete === undefined ? 'Not executed' : scenario.requiredLifecycleComplete ? 'Complete' : 'INCOMPLETE'}</p><p class="scope">${h(Object.entries(scenario.counts).map(([name, count]) => `${name}: ${count}`).join(' · '))}</p>${scenario.issues.length ? `<p class="notice">${h(scenario.issues.join(', '))}</p>` : ''}${records('Phases and attempts', attempts)}${records('Resources and lifecycle', resources)}${records('Selected outputs', outputs)}`;
  }).join('');
  const operations = view.operations.map(operation => fields([['Operation', operation.id], ['Family / target / capability', `${operation.family} / ${operation.target} / ${operation.capability}`], ['Source / version', `${operation.source.kind} / ${operation.source.reference} / ${operation.source.version}`], ['Fingerprint', operation.fingerprint]]));
  const evidence = view.evidence.map(record => fields([['Evidence', record.id], ['Kind / owner', `${record.kind} / ${record.identity.scenarioId} / ${record.identity.attemptId}`], ['Relative path', record.path], ['Bytes', record.bytes], ['SHA256', record.sha256]]));
  return `${scenarios}${records('Operation provenance', operations)}${records('Evidence inventory', evidence)}<p class="scope">Evidence paths refer to the original run. Sensitive values and raw evidence bodies are omitted.</p>`;
}

/** Explicit adapter for validated runtime results, using the same case document. */
export function renderRuntimeHtml(view) {
  const rows = view.scenarios.map(scenario => ({...scenario, title: scenario.id, reason: scenario.reason ?? (scenario.status === 'FAIL' ? `Failed assertions: ${joined(scenario.attempts.flatMap(attempt => attempt.assertions.filter(assertion => assertion.status === 'FAIL' && assertion.reliable).map(assertion => assertion.id)))}` : undefined)})), overview = caseOverview(rows);
  const rendered = rows.map((row, index) => `<details class="case-row" id="case-${index}" data-case data-order="${index}" data-rank="${outcome(row.status).rank}" data-status="${h(row.status)}" data-title="${h(row.title)}" data-search="${h([row.id, row.reason, view.runId].join(' '))}"><summary>${badge(row.status)}<span class="case-main"><span class="case-title">${h(row.title)}</span>${row.reason ? `<span class="case-reason">${h(row.reason)}</span>` : ''}</span><span class="case-methods">${h(row.stability)}</span><span class="case-action">Details <span class="chevron" aria-hidden="true">›</span></span></summary><div class="case-body">${row.reason ? `<p><strong>Reason:</strong> ${h(row.reason)}</p>` : ''}${renderRuntimeEvidence({...view, scenarios: [row], operations: [], evidence: []})}</div></details>`);
  return renderCaseDocument({title: 'Execution results', header: `<p class="eyebrow">Test execution report</p><h1>Execution results</h1><p class="execution-id">Run <code>${h(view.runId)}</code></p><p>${badge(view.status)} · Stability <strong>${h(view.stability)}</strong></p>`, overview, rows, rendered, companions: false,
    overviewContent: `<div class="panel"><dl class="metrics"><div class="metric"><dt>Total test cases</dt><dd>${overview.total}</dd></div><div class="metric pass"><dt>Passed</dt><dd>${overview.passed}</dd></div></dl></div>${renderOutcomeChart(overview)}`,
    afterResults: `<details class="panel supporting"><summary>Execution provenance</summary><div class="supporting-body">${renderRuntimeEvidence({...view, scenarios: []})}</div></details>`,
    footer: `Input fingerprint <code>${h(view.inputFingerprint)}</code><br>Report fingerprint <code>${h(view.fingerprint)}</code><br>Outcomes come from validated runtime evidence.`});
}
