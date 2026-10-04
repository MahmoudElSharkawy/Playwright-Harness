import {createHash} from 'node:crypto';
import {escapeHtml as h} from '../reporting/render.mjs';
import {REPORT_STYLES, REPORT_SCRIPT} from './report-assets.mjs';

const OUTCOMES = {
  PASS: {label: 'PASS', className: 'pass', color: '#208052', rank: 60},
  FAIL: {label: 'FAIL', className: 'fail', color: '#b83347', rank: 10},
  NEEDS_REVIEW: {label: 'NEEDS_REVIEW', className: 'review', color: '#ad740b', rank: 20},
  BLOCKED: {label: 'BLOCKED', className: 'blocked', color: '#b67b20', rank: 30},
  NOT_RUN: {label: 'NOT_RUN', className: 'neutral', color: '#8693a7', rank: 40},
  SKIPPED: {label: 'SKIPPED', className: 'neutral', color: '#8693a7', rank: 50},
  INTEGRITY_FAILURE: {label: 'INTEGRITY FAILURE (no verdict)', className: 'integrity', color: '#944666', rank: 0}
};
const METHODS = ['checked', 'observed', 'mixed', 'unresolved'];
const outcome = value => OUTCOMES[value] ?? {label: value ?? 'No verdict', className: 'neutral', color: '#8693a7', rank: 45};
const caseOutcome = row => row.status ?? row.state ?? 'NOT_RUN';
const badge = value => `<span class="badge ${outcome(value).className}">${h(outcome(value).label)}</span>`;
const raw = (value, label = 'Raw data') => `<details class="raw"><summary>${h(label)}</summary><pre data-raw-json>${h(JSON.stringify(value ?? null, null, 2))}</pre></details>`;
const text = value => typeof value === 'string' ? value || '""' : JSON.stringify(value);
const excerpt = value => {const formatted = text(value) ?? 'Not recorded'; return formatted.length > 640 ? formatted.slice(0, 640) + '… (excerpt; full record in Raw data)' : formatted;};
const own = (value, key) => value && Object.hasOwn(value, key);
const hash = value => createHash('sha256').update(value).digest('base64');
const field = (label, value, className = '') => `<div class="evidence-field ${className}"><dt>${h(label)}</dt><dd>${h(excerpt(value))}</dd></div>`;
const reasonLabel = value => ({'insufficient-evidence': 'Insufficient evidence', 'ambiguous-expected': 'Ambiguous expected behavior', invalidated: 'Earlier failure was invalidated; review required', contradiction: 'Recorded comparisons contradict one another', unresolved: 'The available evidence does not establish an outcome', 'not-readable': 'The required value could not be read', composite: 'Composite behavior assessed from recorded evidence', 'visual-only': 'Visual judgment supported by recorded evidence', 'no-traceable-value': 'No traceable value was available for a deterministic comparison'}[value] ?? value);

/** Counts use the collector's authoritative case rows, never assertion or attempt counts. */
export function executionOverview(view, defectCount) {
  const counts = new Map();
  for (const row of view.scenarios) {const status = caseOutcome(row); counts.set(status, (counts.get(status) ?? 0) + 1);}
  const total = view.scenarios.length, passed = counts.get('PASS') ?? 0;
  return {total, passed, failed: counts.get('FAIL') ?? 0, review: counts.get('NEEDS_REVIEW') ?? 0,
    attempts: view.runs.length, defectGroups: defectCount, passRate: total ? passed / total * 100 : null,
    outcomes: [...counts].map(([status, count]) => ({status, count, percentage: count / total * 100}))};
}

function chart(overview) {
  const rate = overview.passRate === null ? '—' : overview.passRate.toFixed(1) + '%';
  const circumference = 2 * Math.PI * 42; let offset = 0;
  const segments = overview.outcomes.map(item => {
    const length = circumference * item.count / overview.total;
    const circle = `<circle data-chart-status="${h(item.status)}" data-count="${item.count}" cx="60" cy="60" r="42" fill="none" stroke="${outcome(item.status).color}" stroke-width="12" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"></circle>`;
    offset += length; return circle;
  }).join('');
  const description = overview.outcomes.map(item => `${outcome(item.status).label}: ${item.count} cases (${item.percentage.toFixed(1)}%)`).join('; ') || 'No test cases recorded';
  return `<div class="panel chart-panel"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${h(description)}"><circle cx="60" cy="60" r="42" fill="none" stroke="#e6ebf2" stroke-width="12"></circle>${segments}<text class="chart-number" x="60" y="60" text-anchor="middle">${h(rate)}</text><text class="chart-caption" x="60" y="76" text-anchor="middle">pass rate</text></svg><div class="chart-content"><h3>Case outcomes</h3><p class="scope">Complete execution</p>${overview.total ? `<ul class="legend">${overview.outcomes.map(item => `<li><span class="dot" style="--outcome-color:${outcome(item.status).color}" aria-hidden="true"></span><span>${h(outcome(item.status).label)}</span><strong>${item.count}<span class="legend-percent">${item.percentage.toFixed(1)}%</span></strong><button type="button" class="legend-filter" data-filter-status="${h(item.status)}" aria-pressed="false" aria-label="Filter ${h(outcome(item.status).label)} cases" hidden>View</button></li>`).join('')}</ul>` : '<p class="small muted">No case outcomes to display.</p>'}</div></div>`;
}

function actualRecord(record) {
  if (own(record, 'actual')) return {label: 'Actual result', value: record.actual};
  if (own(record, 'observed')) return {label: 'Observed result', value: record.observed};
  if (own(record?.read, 'value')) return {label: 'Recorded read', value: record.read.value};
  if (own(record?.read, 'excerpt')) return {label: 'Recorded read excerpt', value: record.read.excerpt};
  return null;
}

function comparisonRecords(condition, row, assertionEvidence) {
  if (condition.provenance) return condition.provenance.results ?? [];
  return (condition.evidenceIds ?? []).flatMap(id => {
    const value = assertionEvidence.get(`${row.runId}:${id}`);
    return value ? [{...value, status: condition.status, method: condition.method}] : [];
  });
}

function problemFor(scenario, runs, assertionEvidence) {
  const ordered = caseOutcome(scenario) === 'FAIL' ? runs.filter(row => row.result?.status === 'FAIL')
    : runs.filter(row => row.runId === scenario.selectedRunId);
  for (const row of ordered) {
    for (const [index, condition] of (row.conditions ?? []).entries()) {
      if (condition.status === 'PASS') continue;
      const record = comparisonRecords(condition, row, assertionEvidence).find(item => !item.invalidated && item.matching !== false && item.status === condition.status);
      const actual = actualRecord(record);
      return {row, index, condition, reason: actual ? actual.value : reasonLabel(record?.reason) ?? condition.condition.text};
    }
    const reason = row.reason ?? row.result?.scenarios[0]?.reason;
    if (reason) return {row, reason};
  }
  const row = runs.find(item => item.reason);
  return {row, reason: row?.reason ?? (caseOutcome(scenario) === 'NOT_RUN' ? 'No run has been assessed for this case.' : 'Inspect the recorded attempt, verification evidence, and cleanup details.')};
}

function createImages(view, screenshots) {
  const images = [], unique = new Map(), byRun = new Map(), byEvidence = new Map();
  for (const [caseIndex, scenario] of view.scenarios.entries()) {
    for (const [runIndex, row] of view.runs.filter(row => row.scenarioId === scenario.id).entries()) {
      for (const [number, record] of (screenshots.get(row.runId) ?? []).entries()) {
        if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(record.src)) continue;
        const key = hash(record.src); let image = unique.get(key);
        if (!image) {image = {id: `screenshot-${images.length}`, src: record.src, owners: []}; unique.set(key, image); images.push(image);}
        const owner = {caseIndex, runIndex, runId: row.runId, title: scenario.title, caseId: scenario.id, evidenceId: record.id, number: number + 1};
        image.owners.push(owner);
        const refs = byRun.get(row.runId) ?? []; refs.push({image, owner}); byRun.set(row.runId, refs);
        if (record.id) byEvidence.set(`${row.runId}:${record.id}`, image.id);
      }
    }
  }
  return {images, byRun, byEvidence};
}

function evidenceIds(ids, runId, images) {
  return ids.length ? `<div class="evidence-ids"><strong>Evidence identifiers</strong><ul>${[...new Set(ids)].map(id => `<li>${images.byEvidence.has(`${runId}:${id}`) ? `<a data-reveal href="#${images.byEvidence.get(`${runId}:${id}`)}">Screenshot <code>${h(id)}</code></a>` : `<code>${h(id)}</code>`}</li>`).join('')}</ul></div>` : '';
}

function assertion(condition, row, id, assertionEvidence, images) {
  const records = comparisonRecords(condition, row, assertionEvidence);
  const singleActual = records.length === 1 ? actualRecord(records[0]) : null;
  const expected = condition.condition.expected;
  const comparisons = records.map((record, index) => {
    const actual = actualRecord(record), expectedValue = own(record.expected, 'value') ? record.expected.value : record.expected;
    return `<div class="comparison"><div class="comparison-heading">${badge(record.status ?? condition.status)}<span>${h(record.method ?? condition.method)}</span>${records.length > 1 ? `<span>Record ${index + 1}</span>` : ''}${record.invalidated ? '<span class="badge review">Invalidated</span>' : ''}${record.matching === false ? '<span class="badge neutral">Supporting comparison</span>' : ''}${record.stateVersion !== undefined ? `<span class="muted">State ${h(record.stateVersion)}</span>` : ''}</div><dl>${expectedValue !== undefined ? `<div><dt>Expected value</dt><dd>${h(excerpt(expectedValue))}</dd></div>` : ''}${actual && !singleActual ? `<div><dt>${h(actual.label)}</dt><dd>${h(excerpt(actual.value))}</dd></div>` : ''}${record.observed && record.actual !== undefined ? `<div class="wide"><dt>Observation</dt><dd>${h(excerpt(record.observed))}</dd></div>` : ''}${record.rationale ? `<div class="wide"><dt>Evidence rationale</dt><dd>${h(excerpt(record.rationale))}</dd></div>` : ''}${record.reason ? `<div class="wide"><dt>Review reason</dt><dd>${h(reasonLabel(record.reason))}</dd></div>` : ''}${record.whyNotChecked ? `<div class="wide"><dt>Verification approach</dt><dd>${h(reasonLabel(record.whyNotChecked))}</dd></div>` : ''}${record.invalidationReason ? `<div class="wide"><dt>Invalidation reason</dt><dd>${h(record.invalidationReason)}</dd></div>` : ''}</dl></div>`;
  }).join('');
  const proofs = (condition.evidenceIds ?? []).map(id => assertionEvidence.get(`${row.runId}:${id}`)).filter(value => value !== undefined);
  const originals = condition.provenance ?? (proofs.length ? {condition: condition.condition, assertions: proofs} : condition.condition);
  return `<details class="assertion ${outcome(condition.status).className}"${condition.status !== 'PASS' ? ' open' : ''}><summary>${badge(condition.status)}<span class="assertion-title">${h(condition.condition.text)}</span><span class="method-label">${h(condition.method)}</span></summary><div class="assertion-body"><h4 id="${id}" tabindex="-1">Assertion evidence</h4><dl class="evidence-fields">${field('Expected behavior', condition.condition.text)}${singleActual ? field(singleActual.label, singleActual.value, 'actual') : field('Recorded result', records.length > 1 ? 'Multiple records; inspect the comparison history below.' : 'No actual value is recorded in this report payload.', 'actual')}${expected && own(expected, 'value') && !records.length ? field('Expected value', expected.value) : ''}</dl>${comparisons}${evidenceIds(condition.evidenceIds ?? [], row.runId, images)}${raw(originals)}</div></details>`;
}

function diagnostics(records) {
  const groups = new Map(); let count = 0;
  for (const block of records) for (const entry of block.entries) {
    count++; const key = JSON.stringify(entry), group = groups.get(key) ?? {entry, occurrences: []};
    group.occurrences.push({stepId: block.stepId, evidenceId: block.evidenceId, family: block.family, legacy: block.legacy}); groups.set(key, group);
  }
  return `<section class="run-section"><h4>Diagnostics</h4><p class="scope">${count} recorded occurrence${count === 1 ? '' : 's'} · ${groups.size} distinct message${groups.size === 1 ? '' : 's'} in this run. Diagnostics do not determine case outcomes.</p>${count ? `<details><summary class="small">Inspect diagnostic messages</summary><ul class="diagnostic-list">${[...groups.values()].map(({entry, occurrences}) => `<li class="diagnostic-item"><div class="diagnostic-heading"><span class="badge neutral">${h(entry.kind ?? 'Diagnostic')}</span>${entry.notice ? '<span class="badge neutral">Notice</span>' : ''}<span class="muted">${occurrences.length} occurrence${occurrences.length === 1 ? '' : 's'}</span></div><p class="diagnostic-message">${h(excerpt(entry.detail ?? entry.path ?? entry.message ?? 'Diagnostic record'))}</p><dl>${Object.entries(entry).filter(([key]) => !['kind', 'detail', 'message', 'notice'].includes(key)).map(([key, value]) => `<dt>${h(key)}</dt><dd>${h(excerpt(value))}</dd>`).join('')}</dl><details class="small"><summary>Occurrence references</summary><ul>${occurrences.map(item => `<li>Step <code>${h(item.stepId)}</code> · Evidence <code>${h(item.evidenceId)}</code>${item.family ? ` · ${h(item.family)}` : ''}${item.legacy ? ' · legacy' : ''}</li>`).join('')}</ul></details></li>`).join('')}</ul></details>` : '<p class="small muted">No diagnostics recorded in this run.</p>'}${raw(records, 'Raw data · original diagnostic occurrences')}</section>`;
}

function cleanup(resources) {
  const statuses = new Map();
  for (const resource of resources) {const status = resource.lifecycle?.status ?? 'Not recorded'; statuses.set(status, (statuses.get(status) ?? 0) + 1);}
  return `<section class="run-section"><h4>Cleanup</h4><p class="cleanup-summary">${resources.length ? [...statuses].map(([status, count]) => `${count} ${h(status)}`).join(' · ') : 'No tracked resources recorded.'}</p>${raw(resources, 'Raw data · resource lifecycle records')}</section>`;
}

function renderRun(row, scenario, caseIndex, runIndex, assertionEvidence, images) {
  const selected = row.runId === scenario.selectedRunId, historical = runIndex < scenario.history.length - 1;
  const history = scenario.history.find(item => item.runId === row.runId);
  const refs = images.byRun.get(row.runId) ?? [];
  const screenshots = refs.length ? `<section class="run-section"><h4>Screenshot evidence</h4><ul class="screenshot-links">${refs.map(({image, owner}) => `<li><a data-reveal href="#${image.id}">Screenshot ${owner.number}${owner.evidenceId ? ` · ${h(owner.evidenceId)}` : ''}</a></li>`).join('')}</ul></section>` : '';
  const sourceImages = (row.result?.evidence ?? []).filter(item => item.kind === 'screenshot').length;
  const issueIndex = (row.conditions ?? []).findIndex(condition => ['FAIL', 'INDETERMINATE'].includes(condition.status));
  const issue = row.conditions?.[issueIndex];
  const issueRecord = issue ? comparisonRecords(issue, row, assertionEvidence).find(record => !record.invalidated && record.matching !== false && record.status === issue.status) : null;
  const issueActual = actualRecord(issueRecord);
  const issueSummary = issue && (issueActual || issueRecord?.reason) ? `<div class="notice"><p><strong>${issue.status === 'FAIL' ? 'Failure evidence' : 'Review required'}</strong></p><p><strong>Expected:</strong> ${h(issue.condition.text)}</p><p><strong>${issueRecord?.reason ? 'Review reason' : 'Recorded result'}:</strong> ${h(excerpt(issueRecord?.reason ? reasonLabel(issueRecord.reason) : issueActual.value))}</p><a data-reveal href="#assertion-${caseIndex}-${runIndex}-${issueIndex}">Inspect this assertion</a></div>` : '';
  return `<details class="run-details" id="run-${caseIndex}-${runIndex}"${selected ? ' open' : ''}><summary><span class="run-heading"><span>Attempt ${runIndex + 1}</span>${badge(row.result?.status ?? row.state)}${selected ? '<span class="badge neutral">Selected run</span>' : ''}${historical ? '<span class="badge neutral">Historical</span>' : ''}${row.explicitRerun ? '<span class="badge neutral">Explicit rerun</span>' : ''}</span><code class="run-id">${h(row.runId)}</code></summary><div class="run-body">${row.state === 'ASSESSED' ? `<div class="run-links"><a href="runs/${h(row.runId)}/index.html">Core report ↗</a></div>${issueSummary}<h4>Assertions and evidence</h4>${(row.conditions ?? []).map((condition, index) => assertion(condition, row, `assertion-${caseIndex}-${runIndex}-${index}`, assertionEvidence, images)).join('') || '<p class="small muted">No assertion records available.</p>'}${screenshots}${sourceImages > refs.length ? '<p class="scope">Additional screenshot context is listed in the Core report; it was not embedded in this final report.</p>' : ''}${cleanup(row.result.scenarios[0].resources ?? [])}${diagnostics(row.diagnostics ?? [])}` : `<p class="small">${h(row.reason ?? outcome(row.state).label)}</p>${history?.supersededIntegrity ? '<p class="scope">A valid explicit rerun replaced this earlier integrity failure. The original history is retained.</p>' : ''}`}</div></details>`;
}

function renderGallery(images) {
  return images.length ? `<section class="section" aria-labelledby="screenshots-heading"><div class="section-heading"><div><h2 id="screenshots-heading">Detailed screenshot evidence</h2><p class="scope">${images.length} distinct image${images.length === 1 ? '' : 's'} · Recorded context, associated with the attempts below</p></div></div><div class="gallery">${images.map(image => `<figure class="screenshot" id="${image.id}" tabindex="-1"><details class="image-disclosure"><summary><img id="image-${image.id}" src="${h(image.src)}" loading="lazy" alt="Recorded screenshot for ${h(image.owners[0].title)}; attempt ${image.owners[0].runIndex + 1}"><span>Toggle full inline screenshot</span></summary></details><button type="button" class="button" data-enlarge="image-${image.id}" hidden>Enlarge screenshot</button><figcaption>${image.owners.map(owner => `<p><a data-reveal href="#run-${owner.caseIndex}-${owner.runIndex}">${h(owner.caseId)} · Attempt ${owner.runIndex + 1} · Screenshot ${owner.number}</a><br><code>${h(owner.runId)}</code>${owner.evidenceId ? `<br><code>${h(owner.evidenceId)}</code>` : ''}</p>`).join('')}</figcaption></figure>`).join('')}</div><dialog id="screenshot-dialog" aria-labelledby="preview-title"><div class="preview-header"><h2 id="preview-title">Screenshot evidence</h2><button type="button" class="button" id="close-preview" autofocus>Close preview</button></div><img id="preview-image" alt=""></dialog></section>` : '';
}

function revisions(view) {
  return view.revisionCheck ? `<details class="panel supporting"><summary>Source revisions</summary><div class="supporting-body"><p class="scope">Last checked before delivery: ${h(view.revisionCheck.checkedAt)}</p>${view.source.cases.map(tc => {const changed = view.revisionCheck.revisions.find(item => item.caseId === tc.id); return `<div><p class="small">Case ${h(tc.id)}: executed revision ${h(tc.rev)}; current revision ${h(changed?.current ?? tc.rev)} · ${changed ? 'SOURCE CHANGED' : 'unchanged at last check'}</p>${changed ? raw(changed) : ''}</div>`;}).join('')}</div></details>` : '';
}

/** Presentation only. The caller supplies assessed cases, unchanged rollups and verified images. */
export function renderExecutionHtml(view, {defectCount = 0, screenshots = new Map(), assertionEvidence = new Map(), note = ''} = {}) {
  const overview = executionOverview(view, defectCount), images = createImages(view, screenshots);
  const caseRuns = new Map(view.scenarios.map(row => [row.id, view.runs.filter(run => run.scenarioId === row.id)]));
  const attention = view.scenarios.flatMap((scenario, caseIndex) => {
    if (['PASS', 'SKIPPED'].includes(caseOutcome(scenario))) return [];
    const runs = caseRuns.get(scenario.id), problem = problemFor(scenario, runs, assertionEvidence), runIndex = runs.indexOf(problem.row);
    const target = problem.condition ? `assertion-${caseIndex}-${runIndex}-${problem.index}` : `case-details-${caseIndex}`;
    return [`<li class="attention-item ${outcome(caseOutcome(scenario)).className}"><div class="attention-title">${badge(caseOutcome(scenario))}<a data-reveal href="#${target}">${h(scenario.title)}</a></div>${problem.condition ? `<p class="small"><strong>Expected:</strong> ${h(problem.condition.condition.text)}</p>` : ''}<p class="attention-reason"><strong>${problem.condition ? 'Recorded result' : 'Attention'}:</strong> ${h(excerpt(problem.reason))}</p><p class="scope"><code>${h(scenario.id)}</code>${problem.row ? ` · ${h(problem.row.runId)}` : ''}</p></li>`];
  });
  const cases = view.scenarios.map((scenario, index) => {
    const runs = caseRuns.get(scenario.id), status = caseOutcome(scenario);
    const methods = METHODS.filter(method => scenario.methods?.[method]).map(method => `${scenario.methods[method]} ${method}`).join(' · ') || 'No verification rollup recorded';
    const search = [scenario.title, scenario.id, scenario.caseId, ...runs.map(row => row.runId)].join(' ');
    return `<details class="case-row" id="case-${index}" data-case data-order="${index}" data-rank="${outcome(status).rank}" data-status="${h(status)}" data-title="${h(scenario.title)}" data-search="${h(search)}"><summary>${badge(status)}<span class="case-main"><span class="case-title">${h(scenario.title)}</span><span class="case-identifiers"><code>${h(scenario.id)}</code>${scenario.caseId !== undefined ? `<span>Case ${h(scenario.caseId)}</span>` : ''}${runs.length > 1 ? `<span>${runs.length} attempts</span>` : ''}</span></span><span class="case-methods">${h(methods)}</span><span class="case-action">Details <span class="chevron" aria-hidden="true">›</span></span></summary><div class="case-body"><div class="case-context"><h3 id="case-details-${index}" tabindex="-1">Case evidence</h3><p class="scope">${runs.length} run attempt${runs.length === 1 ? '' : 's'} · Case outcome ${h(outcome(status).label)}</p></div><p class="scope">Verification rollup: ${h(methods)}. Source expectations in the selected run.</p>${runs.map((row, runIndex) => renderRun(row, scenario, index, runIndex, assertionEvidence, images)).join('') || '<p class="muted small">No run attempts recorded.</p>'}</div></details>`;
  }).join('');
  const created = view.execution?.createdAt;
  const date = typeof created === 'number' && Number.isFinite(created) && !Number.isNaN(new Date(created).getTime()) ? new Date(created).toISOString() : null;
  const repeated = new Set(view.scenarios.map(row => row.caseId ?? row.id)).size < overview.total;
  const policy = `default-src 'none'; script-src 'sha256-${hash(REPORT_SCRIPT)}'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${h(view.source.title)}</title><style>${REPORT_STYLES}</style></head><body><main><header class="report-header"><p class="eyebrow">Test execution report</p><h1>${h(view.source.title)}</h1><p class="execution-id">Execution <code>${h(view.execution.id)}</code></p>${date || view.freeze?.environment?.name ? `<div class="metadata">${date ? `<span>Created <time datetime="${h(date)}">${h(date)} (UTC)</time></span>` : ''}${view.freeze?.environment?.name ? `<span>Environment <strong>${h(view.freeze.environment.name)}</strong></span>` : ''}</div>` : ''}<nav class="navigation" aria-label="Report navigation"><a href="#overview">Overview</a><a href="#results">Test results</a><a href="summary.md">Summary ↗</a><a href="defects.md">Defects ↗</a></nav>${note ? `<p class="notice">${h(note)}</p>` : ''}</header><section id="overview" aria-labelledby="overview-heading"><div class="section-heading"><div><h2 id="overview-heading">Execution overview</h2><p class="scope">Complete execution${repeated ? ' · Each source case iteration is one reporting row' : ''}</p></div></div><div class="overview-grid"><div class="panel"><dl class="metrics"><div class="metric"><dt>Total test cases</dt><dd data-metric="total">${overview.total}</dd></div><div class="metric pass"><dt>Passed</dt><dd data-metric="passed">${overview.passed}</dd></div><div class="metric fail"><dt>Failed</dt><dd data-metric="failed">${overview.failed}</dd></div><div class="metric rate"><dt>Pass rate</dt><dd data-metric="pass-rate">${overview.passRate === null ? '—' : overview.passRate.toFixed(1) + '%'}</dd></div></dl><p class="scope overview-note">${overview.total ? `${overview.passed} / ${overview.total} passed cases · Passed ÷ total cases` : 'No test cases in this execution. Pass rate is unavailable.'}</p><div class="secondary-metrics"><span><strong>${overview.review}</strong> current review outcomes</span><span><strong>${overview.attempts}</strong> run attempts</span><a href="defects.md"><strong>${h(defectCount)}</strong> defect groups</a></div><p class="scope overview-note">Defect groups combine failed or unresolved expectation findings and diagnostics across assessed attempts.</p></div>${chart(overview)}</div></section><section class="section" aria-labelledby="attention-heading"><div class="section-heading"><div><h2 id="attention-heading">Needs attention</h2><p class="scope">Current case outcomes · Historical review attempts remain in case details</p></div></div>${attention.length ? `<ul class="attention-list">${attention.join('')}</ul>` : `<p class="panel small muted">${overview.total ? 'No current cases need attention.' : 'No case outcomes have been recorded.'}</p>`}</section><section class="section" id="results" aria-labelledby="results-heading"><div class="section-heading"><div><h2 id="results-heading">Test results</h2><p class="scope">Case summaries · Open details for attempts, assertions, and evidence</p></div></div><details class="raw"><summary>How verification methods are counted</summary><div class="supporting-body small"><p>Case summaries group conditions by their source expectation in the selected assessed run. Assertion records below retain individual conditions and comparison history; their counts can differ.</p><p><strong>Checked:</strong> a deterministic comparison. <strong>Observed:</strong> a recorded observation supported by evidence and rationale. <strong>Mixed:</strong> more than one verification classification within a source expectation. <strong>Unresolved:</strong> verification could not establish the condition.</p><p>Verification methods describe evidence, separately from case and attempt outcomes. The collector supplies case outcomes; a historical review does not change a currently passing case. Earlier valid failures remain authoritative under the existing execution rules.</p></div></details>${overview.total ? `<div class="panel toolbar" id="result-controls" hidden><div class="control search"><label for="case-search">Search cases or runs</label><input type="search" id="case-search" placeholder="Title, case ID, or run ID" autocomplete="off" aria-controls="case-list"></div><div class="control"><label for="status-filter">Case outcome</label><select id="status-filter" aria-controls="case-list"><option value="">All outcomes</option>${overview.outcomes.map(item => `<option value="${h(item.status)}">${h(outcome(item.status).label)}</option>`).join('')}</select></div><div class="control"><label for="case-sort">Sort results</label><select id="case-sort" aria-controls="case-list"><option value="original">Original order</option><option value="status">Status · attention first</option><option value="title">Title · A to Z</option></select></div><button type="button" class="button clear" id="clear-filters">Clear filters</button></div>` : ''}<div class="result-meta"><p id="result-count" role="status" aria-live="polite">Showing ${overview.total} of ${overview.total} test cases</p><p class="active-filters" id="active-filters" hidden></p></div><div class="case-list" id="case-list">${cases}</div><div class="panel empty" id="no-results" hidden><h3>No matching test cases</h3><p>Try a shorter search or clear the case outcome filter.</p></div>${overview.total ? '' : '<div class="panel empty"><h3>No test cases recorded</h3><p>This execution has no case results to inspect.</p></div>'}</section>${renderGallery(images.images)}${revisions(view)}<details class="panel supporting"><summary>Source exclusions · ${(view.source.excluded ?? []).length}</summary><div class="supporting-body">${raw(view.source.excluded ?? [])}</div></details><footer class="footer">Outcomes and verification classifications are supplied by the execution collector. Summary, Defects, and Core reports are relative companion-file links. This report works offline.</footer></main><script>${REPORT_SCRIPT}</script></body></html>\n`;
}
