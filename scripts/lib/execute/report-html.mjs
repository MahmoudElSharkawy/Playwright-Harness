import {createHash} from 'node:crypto';
import {escapeHtml as h, stageLabel} from '../reporting/text.mjs';
import {outcome as sharedOutcome, caseOutcome as sharedCaseOutcome, badge as sharedBadge, renderOutcomeChart, renderCaseDocument} from '../reporting/case-view.mjs';

const outcome = sharedOutcome;
const caseOutcome = sharedCaseOutcome;
const badge = sharedBadge;
const text = value => typeof value === 'string' ? value || '""' : JSON.stringify(value);
const excerpt = value => {const formatted = text(value) ?? 'Not recorded'; return formatted.length > 640 ? formatted.slice(0, 640) + '…' : formatted;};
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

const chart = renderOutcomeChart;

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
  if (scenario.reason && caseOutcome(scenario) !== 'FAIL') return {row: runs.at(-1), reason: scenario.reason};
  const ordered = caseOutcome(scenario) === 'FAIL' ? runs.filter(row => row.result?.status === 'FAIL')
    : runs.filter(row => row.runId === scenario.selectedRunId);
  for (const row of ordered) {
    for (const [index, condition] of (caseOutcome(scenario) === 'BLOCKED' ? [] : row.conditions ?? []).entries()) {
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

/** Explain recorded outcomes; a missing reason remains an explicit unknown. */
export function executionCaseExplanation(scenario, runs, assertionEvidence = new Map()) {
  const status = caseOutcome(scenario), problem = problemFor(scenario, runs, assertionEvidence);
  if (status === 'FAIL' && problem.condition) return {reason: `Failed check: ${problem.condition.condition.text} Recorded result: ${excerpt(problem.reason)}`, stage: 'EXECUTE', nextAction: 'Review the expected and actual results, then fix the cause.'};
  if (status === 'FAIL') return {reason: 'Failed execution. Reason unavailable; investigation is needed.', stage: 'EXECUTE', nextAction: 'Review the failed attempt and investigate the cause.'};
  if (scenario.reason) return {reason: scenario.reason, stage: scenario.stage ?? 'EXECUTE', nextAction: scenario.nextAction};
  if (status === 'BLOCKED') {
    const causes = {POLICY: 'the operation is not permitted by the configured environment or runner', UNAVAILABLE: 'a required runtime or dependency is unavailable', TIMEOUT: 'the operation exceeded its deadline', CANCELLED: 'the operation was cancelled', TRANSPORT: 'the connection or transport failed', EXECUTOR: 'the runtime could not complete the operation', DEPENDENCY: 'a required dependency prevented execution', NOT_SELECTED: 'the operation was not selected'};
    const reasons = runs.flatMap(row => {
      const assessed = row.result?.scenarios?.[0];
      const attempts = (assessed?.attempts ?? []).filter(attempt => ['BLOCKED', 'SKIPPED', 'INFRASTRUCTURE_FAILURE'].includes(attempt.outcome));
      return [row.reason, assessed?.reason, ...attempts.map(attempt => `This case could not continue because ${causes[attempt.failureClass] ?? 'the recorded cause is unavailable; investigation is needed'}.`)].filter(Boolean);
    });
    return {reason: [...new Set(reasons)].join(' ') || 'Reason unavailable; investigation is needed.', stage: 'EXECUTE', nextAction: 'Resolve the recorded prerequisite or investigate the unavailable reason, then resume execution.'};
  }
  if (status === 'NEEDS_REVIEW') return {reason: excerpt(problem.reason), stage: 'EXECUTE', nextAction: 'Review the recorded comparisons and unresolved evidence.'};
  return {reason: status === 'NOT_RUN' ? 'No execution has been recorded for this case.' : status === 'INTEGRITY_FAILURE' ? 'The saved run or evidence failed integrity checks; no verdict is available.' : '', stage: 'EXECUTE'};
}

function createImages(view, screenshots) {
  const images = [], unique = new Map(), byRun = new Map(), byEvidence = new Map();
  for (const [caseIndex, scenario] of view.scenarios.entries()) {
    for (const [runIndex, row] of view.runs.filter(row => row.scenarioId === scenario.id).entries()) {
      for (const [number, record] of (screenshots.get(row.runId) ?? []).entries()) {
        if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(record.src)) continue;
        const key = hash(record.src); let image = unique.get(key);
        if (!image) {image = {id: `screenshot-${images.length}`, src: record.src, owners: []}; unique.set(key, image); images.push(image);}
        const owner = {caseIndex, runIndex, runId: row.runId, title: scenario.title, caseId: scenario.caseId ?? scenario.id, evidenceId: record.id, number: number + 1};
        image.owners.push(owner);
        const refs = byRun.get(row.runId) ?? []; refs.push({image, owner}); byRun.set(row.runId, refs);
        if (record.id) byEvidence.set(`${row.runId}:${record.id}`, image.id);
      }
    }
  }
  return {images, byRun, byEvidence};
}

function assertion(condition, row, id, assertionEvidence) {
  const records = comparisonRecords(condition, row, assertionEvidence);
  const comparisons = records.map((record, index) => {
    const actual = actualRecord(record), expected = own(record.expected, 'value') ? record.expected.value : record.expected;
    return `<div class="comparison">${records.length > 1 ? `<div class="comparison-heading">${badge(record.status ?? condition.status)}<span>Result ${index + 1}</span>${record.invalidated ? '<span class="badge neutral">Superseded</span>' : ''}</div>` : ''}<dl>${expected !== undefined ? field('Expected value', expected) : ''}${actual ? field(actual.label, actual.value, 'actual') : field('Actual result', 'Not available')}${record.observed && record.actual !== undefined ? field('Observation', record.observed) : ''}${record.reason ? field('Reason', reasonLabel(record.reason)) : ''}${record.rationale ? field('Explanation', record.rationale) : ''}${record.invalidationReason ? field('Why this result was superseded', record.invalidationReason) : ''}</dl></div>`;
  }).join('');
  return `<details class="assertion ${outcome(condition.status).className}"${condition.status !== 'PASS' ? ' open' : ''}><summary>${badge(condition.status)}<span class="assertion-title">${h(condition.condition.text)}</span></summary><div class="assertion-body"><h4 id="${id}" tabindex="-1">Check details</h4><dl class="evidence-fields">${field('Expected result', condition.condition.text)}${!records.length ? field('Actual result', 'Not available') : ''}</dl>${comparisons}</div></details>`;
}

function cleanupNotice(resources) {
  return resources.some(resource => ['pending', 'failed', 'conflict'].includes(resource.lifecycle?.status)) ? '<p class="notice">Test data cleanup needs attention before this case runs again.</p>' : '';
}

function renderRun(row, scenario, caseIndex, runIndex, assertionEvidence, images) {
  const selected = row.runId === scenario.selectedRunId, historical = runIndex < scenario.history.length - 1;
  const history = scenario.history.find(item => item.runId === row.runId), refs = images.byRun.get(row.runId) ?? [];
  const screenshots = refs.length ? `<section class="run-section"><h4>Screenshots</h4><ul class="screenshot-links">${refs.map(({image, owner}) => `<li><a data-reveal href="#${image.id}">Screenshot ${owner.number}</a></li>`).join('')}</ul></section>` : '';
  return `<details class="run-details" id="run-${caseIndex}-${runIndex}"${selected ? ' open' : ''}><summary><span class="run-heading"><span>Attempt ${runIndex + 1}</span>${badge(row.result?.status ?? row.state)}${historical ? '<span class="badge neutral">Earlier attempt</span>' : ''}</span></summary><div class="run-body">${row.state === 'ASSESSED' ? `${(row.conditions ?? []).map((condition, index) => assertion(condition, row, `assertion-${caseIndex}-${runIndex}-${index}`, assertionEvidence)).join('') || '<p class="small muted">No check results are available for this attempt.</p>'}${screenshots}${cleanupNotice(row.result.scenarios[0].resources ?? [])}` : `<p>${h(row.reason ?? outcome(row.state).label)}</p>${history?.supersededIntegrity ? '<p class="scope">A later attempt produced a verified result.</p>' : ''}`}</div></details>`;
}

function renderGallery(images) {
  return images.length ? `<section class="section" aria-labelledby="screenshots-heading"><div class="section-heading"><div><h2 id="screenshots-heading">Screenshots</h2><p class="scope">${images.length} distinct image${images.length === 1 ? '' : 's'} · Recorded context, associated with the attempts below</p></div></div><div class="gallery">${images.map(image => `<figure class="screenshot" id="${image.id}" tabindex="-1"><details class="image-disclosure"><summary><img id="image-${image.id}" src="${h(image.src)}" loading="lazy" alt="Recorded screenshot for ${h(image.owners[0].title)}; attempt ${image.owners[0].runIndex + 1}"><span>Toggle full inline screenshot</span></summary></details><button type="button" class="button" data-enlarge="image-${image.id}" hidden>Enlarge screenshot</button><figcaption>${image.owners.map(owner => `<p><a data-reveal href="#run-${owner.caseIndex}-${owner.runIndex}">${h(owner.caseId)} · Attempt ${owner.runIndex + 1} · Screenshot ${owner.number}</a></p>`).join('')}</figcaption></figure>`).join('')}</div><dialog id="screenshot-dialog" aria-labelledby="preview-title"><div class="preview-header"><h2 id="preview-title">Screenshots</h2><button type="button" class="button" id="close-preview" autofocus>Close preview</button></div><img id="preview-image" alt=""></dialog></section>` : '';
}

function revisions(view) {
  const changes = view.revisionCheck?.revisions ?? [];
  return changes.length ? `<details class="panel supporting"><summary>Cases changed since execution · ${changes.length}</summary><div class="supporting-body"><ul>${changes.map(row => `<li>Case ${h(row.caseId)} changed after execution. Review the updated case before using this result.</li>`).join('')}</ul></div></details>` : '';
}

function exclusions(rows) {
  if (!rows.length) return '';
  const reasons = {'no-steps': 'No test steps are available.', 'step-limit': 'The case exceeds the supported step limit.', 'shared-parameter-set': 'Shared parameter sets need to be resolved before execution.', 'parameters-without-data': 'Parameter values are missing.', 'iteration-limit': 'The case exceeds the supported iteration limit.', 'data-table-unparsable': 'The parameter table could not be read.', 'shared-step-parameters-unbound': 'Shared-step parameter values are missing.', 'credential-in-expected': 'Expected results contain a credential and need to be sanitized.', 'credential-in-source': 'Test actions contain a credential and need to be sanitized.', 'unparsable-steps': 'The test steps could not be read.'};
  return `<details class="panel supporting"><summary>Cases excluded from execution · ${rows.length}</summary><div class="supporting-body"><p class="scope">These source cases could not enter the execution scope.</p><ul>${rows.map(row => `<li><strong>Case ${h(row.id)}</strong>: ${h(reasons[row.reason] ?? row.reason)}</li>`).join('')}</ul></div></details>`;
}

/** Presentation only. The caller supplies assessed cases, unchanged rollups and verified images. */
export function renderExecutionHtml(view, {defectCount = 0, screenshots = new Map(), assertionEvidence = new Map(), note = ''} = {}) {
  const overview = executionOverview(view, defectCount), images = createImages(view, screenshots);
  const cases = view.scenarios.map((scenario, index) => {
    const runs = view.runs.filter(row => row.scenarioId === scenario.id), status = caseOutcome(scenario);
    const explanation = executionCaseExplanation(scenario, runs, assertionEvidence);
    return `<details class="case-row" id="case-${index}" data-case data-order="${index}" data-rank="${outcome(status).rank}" data-status="${h(status)}" data-title="${h(scenario.title)}" data-search="${h([scenario.title, scenario.id, scenario.caseId, explanation.reason].join(' '))}"><summary>${badge(status)}<span class="case-main"><span class="case-title">${h(scenario.title)}</span><span class="case-identifiers">Case ${h(scenario.caseId ?? scenario.id)}${runs.length > 1 ? `<span>${runs.length} attempts</span>` : ''}</span>${explanation.reason ? `<span class="case-reason">${h(excerpt(explanation.reason))}</span>` : ''}</span><span class="case-action">Details <span class="chevron" aria-hidden="true">›</span></span></summary><div class="case-body"><h3>Case details</h3>${explanation.reason ? `<p><strong>Stage:</strong> ${h(stageLabel(explanation.stage))}</p><p><strong>Reason:</strong> ${h(explanation.reason)}</p>${explanation.nextAction ? `<p><strong>Next action:</strong> ${h(explanation.nextAction)}</p>` : ''}` : ''}${status === 'FAIL' && scenario.reason ? `<p><strong>Other attempt:</strong> ${h(scenario.reason)}</p>` : ''}${runs.map((row, runIndex) => renderRun(row, scenario, index, runIndex, assertionEvidence, images)).join('') || '<p>No execution has been recorded for this case.</p>'}</div></details>`;
  });
  const created = view.execution?.createdAt, date = typeof created === 'number' && Number.isFinite(created) && !Number.isNaN(new Date(created).getTime()) ? new Date(created).toISOString() : null;
  return renderCaseDocument({title: view.source.title, header: `<p class="eyebrow">Test execution report</p><h1>${h(view.source.title)}</h1>${date || view.freeze?.environment?.name ? `<div class="metadata">${date ? `<span>Created <time datetime="${h(date)}">${h(date)} (UTC)</time></span>` : ''}${view.freeze?.environment?.name ? `<span>Environment <strong>${h(view.freeze.environment.name)}</strong></span>` : ''}</div>` : ''}`, overview, overviewNote: 'All test cases', overviewContent: `<div class="panel"><dl class="metrics"><div class="metric"><dt>Total test cases</dt><dd data-metric="total">${overview.total}</dd></div><div class="metric pass"><dt>Passed</dt><dd data-metric="passed">${overview.passed}</dd></div><div class="metric fail"><dt>Failed</dt><dd data-metric="failed">${overview.failed}</dd></div><div class="metric rate"><dt>Pass rate</dt><dd data-metric="pass-rate">${overview.passRate === null ? '—' : overview.passRate.toFixed(1) + '%'}</dd></div></dl><p class="scope overview-note">${overview.total ? `${overview.passed} of ${overview.total} cases passed` : 'No test cases recorded.'}</p><div class="secondary-metrics"><span><strong>${overview.review}</strong> need review</span><a href="defects.md"><strong>${defectCount}</strong> findings</a></div></div>${chart(overview)}`, rows: view.scenarios, rendered: cases, afterResults: `${renderGallery(images.images)}${revisions(view)}${exclusions(view.source.excluded ?? [])}`, note, footer: 'Summary and Defects include the case outcomes and findings.'});
}
