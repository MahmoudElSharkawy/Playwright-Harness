import {createHash} from 'node:crypto';
import {escapeHtml as h, stageLabel, caseReason} from './text.mjs';
import {REPORT_STYLES, REPORT_SCRIPT} from './case-assets.mjs';

const OUTCOMES = {
  NOT_STARTED: {label: 'Not started', className: 'neutral', color: 'var(--todo)', rank: 40},
  PASS: {label: 'Passed', className: 'pass', color: 'var(--ok)', rank: 60},
  FAIL: {label: 'Failed', className: 'fail', color: 'var(--crit)', rank: 10},
  NEEDS_REVIEW: {label: 'Needs review', className: 'review', color: 'var(--fold)', rank: 20},
  BLOCKED: {label: 'Blocked', className: 'blocked', color: 'var(--warn)', rank: 30},
  NOT_RUN: {label: 'Not run', className: 'neutral', color: 'var(--todo)', rank: 40},
  NOT_GENERATED: {label: 'Not generated', className: 'neutral', color: 'var(--todo)', rank: 40},
  PENDING: {label: 'Pending', className: 'neutral', color: 'var(--fold)', rank: 45},
  SKIPPED: {label: 'Skipped', className: 'neutral', color: 'var(--todo)', rank: 50},
  READY: {label: 'Ready', className: 'pass', color: 'var(--ok)', rank: 70},
  INTEGRITY_FAILURE: {label: 'INTEGRITY FAILURE (no verdict)', className: 'integrity', color: 'var(--crit)', rank: 0}
};
export const outcome = value => OUTCOMES[value] ?? {label: value ?? 'No verdict', className: 'neutral', color: '#8693a7', rank: 45};
export const caseOutcome = row => row.status ?? row.state ?? 'NOT_RUN';
export const badge = value => `<span class="badge ${outcome(value).className}">${h(outcome(value).label)}</span>`;

/** Each row is one case; attempts never inflate the chart. */
export function caseOverview(rows) {
  const counts = new Map();
  for (const row of rows) {const status = caseOutcome(row); counts.set(status, (counts.get(status) ?? 0) + 1);}
  const total = rows.length, passed = counts.get('PASS') ?? 0;
  return {total, passed, passRate: total ? passed / total * 100 : null,
    outcomes: [...counts].map(([status, count]) => ({status, count, percentage: count / total * 100}))};
}

export function renderOutcomeChart(overview, {scope = 'Complete execution', value, caption = 'pass rate'} = {}) {
  const center = value ?? (overview.passRate === null ? '—' : overview.passRate.toFixed(1) + '%');
  const circumference = 2 * Math.PI * 42; let offset = 0;
  const segments = overview.outcomes.map(item => {
    const length = circumference * item.count / overview.total;
    const circle = `<circle data-chart-status="${h(item.status)}" data-count="${item.count}" cx="60" cy="60" r="42" fill="none" stroke="${outcome(item.status).color}" stroke-width="12" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"></circle>`;
    offset += length; return circle;
  }).join('');
  const description = overview.outcomes.map(item => `${outcome(item.status).label}: ${item.count} cases (${item.percentage.toFixed(1)}%)`).join('; ') || 'No test cases recorded';
  return `<div class="panel chart-panel"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${h(description)}"><circle cx="60" cy="60" r="42" fill="none" stroke="#e6ebf2" stroke-width="12"></circle>${segments}<text class="chart-number" x="60" y="60" text-anchor="middle">${h(center)}</text><text class="chart-caption" x="60" y="76" text-anchor="middle">${h(caption)}</text></svg><div class="chart-content"><h3>Case outcomes</h3><p class="scope">${h(scope)}</p>${overview.total ? `<ul class="legend">${overview.outcomes.map(item => `<li><span class="dot" style="--outcome-color:${outcome(item.status).color}" aria-hidden="true"></span><span>${h(outcome(item.status).label)}</span><strong>${item.count}<span class="legend-percent">${item.percentage.toFixed(1)}%</span></strong><button type="button" class="legend-filter" data-filter-status="${h(item.status)}" aria-pressed="false" aria-label="Filter ${h(outcome(item.status).label)} cases" hidden>View</button></li>`).join('')}</ul>` : '<p class="small muted">No case outcomes to display.</p>'}</div></div>`;
}

export function renderCaseControls(overview) {
  if (!overview.total) return '';
  const attention = overview.outcomes.filter(item => ['FAIL', 'BLOCKED', 'NEEDS_REVIEW', 'INTEGRITY_FAILURE'].includes(item.status)).reduce((sum, item) => sum + item.count, 0);
  return `<div class="toolbar" id="result-controls" hidden><div class="search-tools"><div class="control search"><label for="case-search">Search cases</label><input type="search" id="case-search" placeholder="Title, case ID or reason" autocomplete="off" aria-controls="case-list"></div><div class="control"><label for="case-sort">Sort within groups</label><select id="case-sort" aria-controls="case-list"><option value="original">Source order</option><option value="title">Title · A to Z</option></select></div><button type="button" class="button clear" id="clear-filters">Clear filters</button></div><fieldset class="status-filters" id="status-filter"><legend>Statuses <span>Select multiple</span></legend><div class="status-options"><button type="button" class="button" id="all-statuses" aria-pressed="true">All statuses</button>${overview.outcomes.slice().sort((a, b) => outcome(a.status).rank - outcome(b.status).rank).map(item => `<label class="status-choice"><input type="checkbox" value="${h(item.status)}" aria-controls="case-list"><span>${h(outcome(item.status).label)}</span><span class="status-count" aria-hidden="true">${item.count}</span></label>`).join('')}</div></fieldset><div class="list-tools">${attention ? `<button type="button" class="button attention-filter" data-attention aria-pressed="false">Needs attention <strong>${attention}</strong></button>` : '<span></span>'}<div class="group-actions"><button type="button" class="button" id="expand-groups">Expand groups</button><button type="button" class="button" id="collapse-groups">Collapse groups</button></div></div><p class="scope">Open a status group to see cases. Each page shows up to 10 cases; open a case for evidence and next actions.</p></div>`;
}

/** Group by the recorded disposition, without inferring unavailable suite metadata. */
export function renderCaseGroups(rows, rendered) {
  const groups = new Map();
  rows.forEach((row, index) => {const status = caseOutcome(row); if (!groups.has(status)) groups.set(status, []); groups.get(status).push(rendered[index]);});
  return [...groups].sort(([a], [b]) => outcome(a).rank - outcome(b).rank).map(([status, cases]) => `<details class="case-group" data-group data-group-status="${h(status)}"><summary class="group-heading"><span class="group-caret" aria-hidden="true">▶</span>${badge(status)}<span class="group-count">${cases.length} cases</span></summary><div class="group-rows">${cases.join('')}</div><div class="pager" hidden><span class="page-label"></span><div class="group-actions"><button type="button" class="button" data-page="-1">Previous</button><button type="button" class="button" data-page="1">Next</button></div></div></details>`).join('');
}

/** One document and navigation for skill reports and validated-runtime attachments. */
export function renderCaseDocument({title, header, overview, overviewTitle = 'Execution overview', overviewNote = '', overviewContent, rows, rendered, afterResults = '', footer, companions = true, note = ''}) {
  const hash = createHash('sha256').update(REPORT_SCRIPT).digest('base64');
  const policy = `default-src 'none'; script-src 'sha256-${hash}'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${h(title)}</title><style>${REPORT_STYLES}</style></head><body><main><header class="report-header"><div class="report-heading">${header}<button type="button" class="theme-toggle" id="theme-toggle" data-next-theme="dark" aria-label="Switch to dark theme" title="Switch to dark theme" aria-pressed="false" hidden><svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 13.1A9 9 0 0 1 10.9 3 9 9 0 1 0 21 13.1Z"></path></svg><svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg></button></div><nav class="navigation" aria-label="Report navigation"><a href="#overview">Overview</a><a href="#results">Test results</a>${companions ? '<a href="summary.md">Summary ↗</a><a href="defects.md">Defects ↗</a>' : ''}</nav>${note ? `<p class="notice">${h(note)}</p>` : ''}</header><section id="overview" aria-labelledby="overview-heading"><div class="section-heading"><div><h2 id="overview-heading">${h(overviewTitle)}</h2>${overviewNote ? `<p class="scope">${h(overviewNote)}</p>` : ''}</div></div><div class="overview-grid">${overviewContent}</div></section><section class="section" id="results" aria-labelledby="results-heading"><div class="section-heading"><div><h2 id="results-heading">Test results</h2><p class="scope">Open a case for recorded evidence and next actions.</p></div></div>${renderCaseControls(overview)}<div class="result-meta"><p id="result-count" role="status" aria-live="polite">Showing ${overview.total} of ${overview.total} test cases</p><p class="active-filters" id="active-filters" hidden></p></div><div class="case-list" id="case-list">${renderCaseGroups(rows, rendered)}</div><div class="panel empty" id="no-results" hidden><h3>No matching test cases</h3><p>Try a shorter search or clear the case outcome filter.</p></div>${overview.total ? '' : '<div class="panel empty"><h3>No test cases recorded</h3><p>No case outcome is inferred.</p></div>'}</section>${afterResults}<footer class="footer">${footer} This report works offline.</footer></main><script>${REPORT_SCRIPT}</script></body></html>\n`;
}

/** Presentation only; user-facing outcomes, reasons and next actions. */
export function renderAutomationHtml(view) {
  const overview = caseOverview(view.cases), count = status => overview.outcomes.find(item => item.status === status)?.count ?? 0;
  const rows = view.cases.map((row, index) => `<details class="case-row" id="case-${index}" data-case data-order="${index}" data-rank="${outcome(row.status).rank}" data-status="${h(row.status)}" data-title="${h(row.title)}" data-search="${h([row.id, row.title, caseReason(row.reason)].join(' '))}"><summary>${badge(row.status)}<span class="case-main"><span class="case-title">${h(row.title)}</span><span class="case-identifiers">${h(row.id)}</span>${row.reason ? `<span class="case-reason">${h(caseReason(row.reason))}</span>` : ''}</span><span class="case-action">Details <span class="chevron" aria-hidden="true">›</span></span></summary><div class="case-body"><h3>Case details</h3><p><strong>Stage:</strong> ${h(stageLabel(row.stage))}</p><p><strong>Reason:</strong> ${h(caseReason(row.reason) || 'Reason unavailable; investigation is needed.')}</p>${row.nextAction ? `<p><strong>Next action:</strong> ${h(row.nextAction)}</p>` : ''}${row.assertions ? `<p>${row.assertions.passed} checks passed · ${row.assertions.failed} failed</p>` : ''}${row.expectations?.length ? `<details class="raw"><summary>Expected results</summary><ul>${row.expectations.map(item => `<li>${h(item)}</li>`).join('')}</ul></details>` : ''}</div></details>`);
  return renderCaseDocument({title: `${view.title} · Automation results`, header: `<p class="eyebrow">Test automation report</p><h1>${h(view.title)}</h1><div class="metadata"><span>Generated <time datetime="${h(view.createdAt)}">${h(view.createdAt)} (UTC)</time></span><span>Environment <strong>${h(view.environment ?? 'Not recorded')}</strong></span></div><p><strong>Automation status:</strong> ${badge(view.status)}</p>${view.blocker ? `<p class="notice"><strong>${h(stageLabel(view.blocker.stage))} stopped:</strong> ${h(caseReason(view.blocker.reason))}${view.blocker.nextAction ? `<br><strong>Next action:</strong> ${h(view.blocker.nextAction)}` : ''}</p>` : ''}`, overview, overviewTitle: 'Automation overview', overviewContent: `<div class="panel"><dl class="metrics"><div class="metric"><dt>Total test cases</dt><dd data-metric="total">${overview.total}</dd></div><div class="metric fail"><dt>Failed</dt><dd data-metric="failed">${count('FAIL')}</dd></div><div class="metric"><dt>Blocked</dt><dd data-metric="blocked">${count('BLOCKED')}</dd></div><div class="metric pass"><dt>Ready</dt><dd data-metric="ready">${count('READY')}</dd></div></dl></div>${renderOutcomeChart(overview, {scope: 'All test cases', value: overview.total, caption: 'cases'})}`, rows: view.cases, rendered: rows, footer: 'Summary and Defects include the case outcomes and findings.'});
}
