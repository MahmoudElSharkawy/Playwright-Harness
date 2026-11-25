import {escapeHtml as h} from '../reporting/render.mjs';

const paragraph = text => `<p>${h(text).replace(/\r?\n/g, '<br>')}</p>`;
const section = (title, content) => content ? `<h3>${title}</h3>${content}` : '';
const lines = text => text?.trim().split(/\r?\n/) ?? [];

function prose(text) {
  const blocks = text?.trim().split(/\r?\n\s*\r?\n/) ?? [];
  return blocks.filter(Boolean).map(block => {
    const groups = block.match(/(?:^- .*$(?:\r?\n|$))+|^(?!- ).+$/gm) ?? [];
    return groups.map(group => group.startsWith('- ')
      ? `<ul>${lines(group).map(line => `<li>${h(line.slice(2))}</li>`).join('')}</ul>`
      : paragraph(group)).join('');
  }).join('');
}

// Draft notes support only the formatting the report layout uses.
function technicalNotes(text) {
  return (text ?? '').replace(/\r\n/g, '\n').split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m).map((part, index) => {
    if (index % 2) return `<pre><code>${h(part.slice(part.indexOf('\n') + 1, part.lastIndexOf('\n')))}</code></pre>`;
    return part.trim().split(/\n\s*\n/).filter(Boolean).map(block => {
      const rows = lines(block);
      if (rows.length >= 3 && rows.every(row => /^\|.*\|$/.test(row)) && /^\|(?:\s*-{3,}\s*\|)+$/.test(rows[1])) {
        const cells = (row, tag) => '<tr>' + row.slice(1, -1).split('|').map(cell => `<${tag}>${h(cell.trim())}</${tag}>`).join('') + '</tr>';
        return `<table><thead>${cells(rows[0], 'th')}</thead><tbody>${rows.slice(2).map(row => cells(row, 'td')).join('')}</tbody></table>`;
      }
      return prose(block).replace(/<p>\*\*([^*\n]+)\*\*/g, '<p><strong>$1</strong>');
    }).join('');
  }).join('');
}

export function bugScreenshots(attachments) {
  const seen = new Set();
  return attachments.filter(record => {
    if (record.kind !== 'screenshot' || record.sourceSha256 || record.eligible === false || seen.has(record.sha256)) return false;
    seen.add(record.sha256);
    return true;
  });
}

function pictures(attachments) {
  return bugScreenshots(attachments).map((raw, index) => {
    const annotated = attachments.find(record => record.sourceSha256 === raw.sha256);
    return `Image ${index + 1} – ${raw.caption ?? 'Screenshot'} (${annotated?.name ?? raw.name ?? `${raw.id}.png`})`;
  });
}

/** Summarize selected observations without implying a reproduction denominator. */
export function executionBugActual(defect) {
  const labels = {FAIL: 'Recorded failure occurrences', INDETERMINATE: 'Inconclusive observations', DIAGNOSTIC: 'Recorded diagnostics'};
  return Object.entries(labels).flatMap(([status, label]) => {
    const count = (defect.occurrences ?? []).filter(row => row.status === status).length;
    return count ? [`${label}: ${count}.`] : [];
  }).join('\n') || 'No conclusive actual result was recorded.';
}

/** Render only readable source/confirmation facts, never the captured tracking object. */
export function renderBugNarrative(view, defect, edited, changed, {attachments = [], legacy = false, recordedObservation = ''} = {}) {
  const context = view.reportContext, source = context?.source ?? {}, workflow = source.postRun?.run.workflow;
  let captured;
  if (source.postRun || source.executionId) {try {captured = JSON.parse(source.content);} catch { /* A plain source description has no structured presentation fields. */ }}
  const origin = workflow === 'automate-test' ? 'Automated tests' : workflow === 'execute-test' || source.executionId || !context ? 'Test execution' : 'User report';
  const storyId = source.storyId ?? (view.source.scope.kind === 'story' ? view.source.scope.storyId : undefined);
  const cases = [...new Set([defect.caseId, source.caseId, ...(source.postRun?.references ?? []).map(row => row.caseId), ...(captured?.scenarios ?? []).map(row => row.caseId ?? row.id)].filter(value => typeof value === 'string' || Number.isSafeInteger(value)))];
  const sourceDetails = [`Source: ${origin}`, ...(storyId ? [`Story #${storyId}`] : []), ...cases.map(value => `Test case ${typeof value === 'number' ? '#' : ''}${value}`)];
  const confirmation = context?.confirmation;
  const user = confirmation ? confirmation.user === 'confirmed' ? 'Confirmed' : 'Not confirmed' : 'Not recorded';
  const agent = confirmation ? {'not-run': 'Not performed', reproduced: 'Reproduced', inconclusive: 'Inconclusive', 'not-reproduced': 'Not reproduced'}[confirmation.agent]
    : defect.status === 'FAIL' ? 'Failure observed in recorded execution' : defect.status === 'INDETERMINATE' ? 'Inconclusive' : 'Not established by diagnostics';
  const legacyNotes = `Verified execution ${source.executionId}; ${source.defectFingerprint}`;
  const notes = source.executionId && confirmation?.notes === legacyNotes ? 'The failure was verified in the recorded execution; no additional reproduction was performed.' : confirmation?.notes;
  const header = `<p>${sourceDetails.map(h).join('; ')}</p><p>User confirmation: ${h(user)}</p><p>Agent reproduction: ${h(agent)}</p>${notes ? `<p>${h(notes)}</p>` : ''}`;
  const scenario = view.source.scenarios.find(item => item.id === defect.scenarioId);
  // Recognize older generated defaults without rewriting saved drafts or arbitrary API JSON supplied by a user.
  const legacyActual = source.executionId && Array.isArray(captured?.occurrences) && edited.actual === JSON.stringify(captured.occurrences);
  const actual = legacyActual ? executionBugActual(captured) : edited.actual ?? executionBugActual(defect);
  const revisions = changed ? [
    ...(changed.executed !== changed.current ? [`Test case #${changed.caseId}: executed revision ${changed.executed}, current revision ${changed.current ?? 'unavailable'}.`] : []),
    ...(changed.sharedSteps ?? []).map(row => `Shared steps #${row.id}: executed revision ${row.executed}, current revision ${row.current ?? 'unavailable'}.`)
  ] : [];
  const revision = changed ? `<p>Source changed after execution. Review the changed source before relying on this result.</p>${revisions.map(text => `<p>${h(text)}</p>`).join('')}` : '';
  if (legacy) {
    const originalSteps = scenario?.steps.map(step => `${step.position}. ${step.action}\nExpected: ${step.expected.join('; ')}`).join('\n') ?? '';
    return {actual, html: `${header}<p>${h(edited.description ?? '')}</p><h3>Prerequisites</h3><pre>${h((edited.prerequisites ?? []).join('\n'))}</pre><h3>Steps to reproduce</h3><pre>${h(edited.steps?.map((step, index) => `${index + 1}. ${step}`).join('\n') ?? originalSteps)}</pre><h3>Expected</h3><pre>${h(edited.expected ?? originalSteps)}</pre><h3>Actual</h3><pre>${h(actual)}</pre><p>${h(edited.notes ?? '')}</p>${revision}`};
  }
  const captions = pictures(attachments);
  const withImages = text => text.replace(/[ \t]*\(image ([1-9]\d*)\)/gi, (reference, number) => Number(number) <= captions.length ? reference : '');
  const steps = edited.steps ?? executionBugSteps(scenario);
  const setup = edited.prerequisites?.filter(value => value.trim()) ?? [];
  const numbered = steps.map(withImages).filter(step => step.trim()).map(step => `<li>${h(step).replace(/\r?\n/g, '<br>')}</li>`).join('');
  const expected = edited.expected ?? scenario?.steps.flatMap(step => step.expected).filter(Boolean).join('\n');
  const citation = expected && !/^Source:/mi.test(expected)
    ? paragraph(edited.expected === undefined && scenario?.caseId
      ? `Source: Test case #${scenario.caseId}, expected results`
      : 'Source: Requirement and section unspecified.') : '';
  const executionDefault = !context || source.executionId;
  const counts = executionBugActual(captured?.occurrences ? captured : defect);
  const generated = executionDefault && (edited.actual === undefined || legacyActual || edited.actual === counts);
  const observed = generated ? recordedObservation || (counts.startsWith('Recorded failure occurrences')
    ? 'The recorded result differed from the expected behavior. The observed value needs review.'
    : 'No conclusive actual result was recorded.') : actual;
  const configuration = edited.configuration ?? view.freeze?.environment?.name;
  return {actual, html: [
    paragraph(edited.description?.trim() || edited.title || defect.title || 'Bug report'),
    section('Steps', (setup.length ? paragraph(`Before you start: ${setup.join('\n')}`) : '') + (numbered ? `<ol>${numbered}</ol>` : '')),
    section('Expected Result', prose(expected) + citation),
    section('Actual Result', prose(withImages(observed))),
    section('Pictures', captions.map(paragraph).join('')),
    section('Technical details', technicalNotes(edited.notes) + header + (generated ? prose(counts) : '') + revision),
    configuration?.trim() ? `<p><strong>Test configuration</strong>: ${h(configuration)}</p>` : ''
  ].join('')};
}

export function executionBugSteps(scenario) {
  return (scenario?.steps ?? []).map(step => step.action).filter(Boolean);
}
