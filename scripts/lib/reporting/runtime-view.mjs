import {escapeHtml as h} from './text.mjs';
import {badge, outcome, caseOverview, renderOutcomeChart, renderCaseDocument} from './case-view.mjs';

function reason(row) {
  if (row.reason) return row.reason;
  if (row.status === 'PASS') return '';
  const latest = new Map(row.attempts.map(attempt => [attempt.identity.invocationId, attempt]));
  const causes = [...latest.values()].map(attempt => ({
    ASSERTION: 'One or more checks failed.', TIMEOUT: 'The test exceeded its time limit.',
    UNAVAILABLE: 'A required service or dependency was unavailable.', TRANSPORT: 'The connection to a required service failed.',
    CANCELLED: 'The test was interrupted.', EXECUTOR: 'The test could not finish because its runner encountered a problem.',
    POLICY: 'The requested operation is not permitted in this environment.', DEPENDENCY: 'A prerequisite was not completed.',
    NOT_SELECTED: 'This operation was not selected to run.'
  }[attempt.failureClass])).filter(Boolean);
  if (row.requiredLifecycleComplete === false) causes.push('Test data cleanup needs attention.');
  for (const issue of row.issues) causes.push({'assertion-instability': 'Some checks produced inconsistent results.', 'contradictory-evidence': 'The recorded results disagree.', 'indeterminate-outcome': 'The test outcome could not be confirmed.'}[issue]);
  if (!causes.length) causes.push(row.status === 'FAIL' ? 'One or more checks failed.' : 'The test result could not be confirmed. Review the recorded result before running it again.');
  return [...new Set(causes)].join(' ');
}

/** User-facing projection. Detailed proof remains in the validated internal records. */
export function renderRuntimeHtml(view) {
  const rows = view.scenarios.map(row => ({...row, title: row.id, reason: reason(row)}));
  const overview = caseOverview(rows);
  const rendered = rows.map((row, index) => `<details class="case-row" id="case-${index}" data-case data-order="${index}" data-rank="${outcome(row.status).rank}" data-status="${h(row.status)}" data-title="${h(row.title)}" data-search="${h([row.id, row.reason].join(' '))}"><summary>${badge(row.status)}<span class="case-main"><span class="case-title">${h(row.title)}</span><span class="case-identifiers">Case ${index + 1}</span>${row.reason ? `<span class="case-reason">${h(row.reason)}</span>` : ''}</span><span class="case-action">Details <span class="chevron" aria-hidden="true">›</span></span></summary><div class="case-body"><h3>Case details</h3>${row.reason ? `<p><strong>Reason:</strong> ${h(row.reason)}</p>` : ''}<p>${row.counts.passed} checks passed · ${row.counts.failed} failed</p>${row.requiredLifecycleComplete === false ? '<p class="notice">Test data cleanup needs attention before this case runs again.</p>' : ''}${['FAIL', 'NEEDS_REVIEW', 'BLOCKED'].includes(row.status) ? '<p><strong>Next action:</strong> Check the cause above and resolve it before running this case again.</p>' : ''}</div></details>`);
  return renderCaseDocument({title: 'Execution results', header: `<p class="eyebrow">Test execution report</p><h1>Execution results</h1><p>${badge(view.status)}</p>`, overview, rows, rendered, companions: false,
    overviewContent: `<div class="panel"><dl class="metrics"><div class="metric"><dt>Total test cases</dt><dd>${overview.total}</dd></div><div class="metric pass"><dt>Passed</dt><dd>${overview.passed}</dd></div></dl></div>${renderOutcomeChart(overview)}`,
    footer: 'Results reflect this execution.'});
}
