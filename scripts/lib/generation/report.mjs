import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {data, digest, fingerprint, frozen, requireThat, integer, id, keys} from '../execution-core/data.mjs';
import {validateLocalSource} from '../local-source.mjs';
import {transaction, relativeFile, reviewArtifact} from './storage.mjs';
import {generationStateStatus, currentCandidate, approvedCandidate} from './index.mjs';
import {generationBlocker, GENERATION_STAGES} from './reasons.mjs';
import {caseNotes} from '../reporting/case-notes.mjs';
import {timestampedReportDirectory} from '../reporting/directories.mjs';
import {renderAutomationHtml, outcome, automationCoverageText, caseNeedsAttention} from '../reporting/case-view.mjs';
import {markdownText as md, caseReason, stageLabel, dbDiscoveryLines} from '../reporting/text.mjs';
import {reportSource, reportingContext} from './reporting-context.mjs';
import {readApiDiscoverySummary} from '../browser/api-capture.mjs';
import {readDbDiscoverySummary} from '../database/discovery.mjs';
export {renderAutomationHtml};

const identity = test => fingerprint([test.spec, test.project, test.titlePath]);
const MATCHERS = new Set(['assertion', 'toBe', 'toEqual', 'toStrictEqual', 'toBeTruthy', 'toBeFalsy', 'toContain', 'toMatch', 'toHaveLength', 'toBeVisible', 'toBeHidden', 'toHaveText', 'toContainText', 'toHaveValue', 'toHaveCount', 'toHaveURL', 'toHaveTitle', 'toBeEnabled', 'toBeDisabled', 'toBeChecked']);

function nativeReceipt(roots, run, candidate) {
  if (!run?.receipt) return null;
  requireThat(run.receipt.path === `.harness/state/generation/${candidate.sourceId}/${run.id}/execution.json`, 'Native receipt path differs from its recorded invocation.');
  const bytes = readFileSync(relativeFile(roots, run.receipt.path));
  requireThat(bytes.length <= 2 * 1024 * 1024, 'Native report exceeds bounds.');
  const report = data(JSON.parse(bytes.toString('utf8')));
  requireThat(fingerprint(report) === run.receipt.fingerprint && report.version === 2 && report.invocation === run.id && Array.isArray(report.tests), 'Native report integrity or invocation changed.');
  requireThat(report.tests.length === candidate.tests.length && candidate.tests.every(test => report.tests.filter(actual => identity(actual) === identity(test)).length === 1), 'Native report scope differs from the candidate.');
  return report;
}

function nativeCase(test, run, readiness) {
  const result = test?.results?.at(-1);
  if (!result) return {status: run?.status === 'STARTED' ? 'PENDING' : 'NOT_RUN', reason: 'No native result was recorded for this case.', nativeStatus: 'not run'};
  requireThat(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status) && integer(result.errors) && integer(result.assertions?.passed) && integer(result.assertions?.failed) && integer(result.skippedSteps), 'Native case result is invalid.');
  const assertionFailure = result.assertions.failed > 0;
  const status = result.status === 'failed' || assertionFailure ? 'FAIL' : result.status === 'skipped' ? 'SKIPPED' : ['timedOut', 'interrupted'].includes(result.status) ? 'BLOCKED' : !result.assertions.passed || result.skippedSteps || result.errors || result.retry !== 0 ? 'NEEDS_REVIEW' : readiness === 'READY' ? 'READY' : 'PASS';
  const checks = Array.isArray(result.failedChecks) ? [...new Set(result.failedChecks.filter(check => MATCHERS.has(check)))].slice(0,20) : [];
  const reason = status === 'FAIL' ? `${assertionFailure ? `${result.assertions.failed} native assertion(s) failed${checks.length ? ` (${checks.join(', ')})` : ''}.` : 'The native test failed.'} ${run.reason ?? 'Inspect the recorded test and source expectations.'}`
    : status === 'BLOCKED' ? `Native execution ${result.status === 'timedOut' ? 'exceeded its deadline' : 'was interrupted'}. ${run.reason ?? ''}`
    : status === 'NEEDS_REVIEW' ? 'The native test has missing or skipped assertions; the verification gate is not satisfied.'
    : status === 'SKIPPED' ? 'The native test was skipped; it does not count as a scoped green.'
    : status === 'READY' ? 'Two intact scoped green runs and independent approval establish automation readiness.'
    : 'The native test passed; automation readiness still depends on the complete scoped verification gates.';
  return {status, reason, nativeStatus: result.status, assertions: result.assertions,
    ...(status === 'FAIL' || status === 'BLOCKED' || status === 'NEEDS_REVIEW' ? {nextAction: run.nextAction ?? 'Resolve the recorded cause, then register and independently review any repair before verification.'} : {})};
}

/** Older results remain evidence of that scope, never readiness for today's subset. */
function historicalCase(roots, state, candidate, scenario, handoff, receipts, run = state.runs.filter(row => row.revision === candidate.revision).at(-1)) {
  const needsReview = reason => ({status: 'NEEDS_REVIEW', stage: 'VERIFY', reason, nextAction: 'Review the original case and saved result, then include the accepted case in a freshly reviewed verification scope.'});
  try {
    requireThat(handoff && candidate.sourceFingerprint === handoff.fingerprint && candidate.gate === 'case-assertions', 'The earlier verification cannot be bound to its assessed source.');
    const original = handoff.source.scenarios.find(row => row.id === scenario.id);
    requireThat(original && fingerprint(original) === fingerprint(scenario), 'The case requirements changed after the earlier verification; its outcome does not establish the current result.');
    const review = state.reviews.filter(row => row.revision === candidate.revision).at(-1);
    requireThat(review?.verdict === 'APPROVE' && fingerprint(reviewArtifact(roots, review.artifact.path)) === fingerprint(review.artifact), 'The earlier verification approval is missing or changed.');
    if (candidate.change) requireThat(fingerprint(reviewArtifact(roots, candidate.change.artifact.path)) === fingerprint(candidate.change.artifact), 'The earlier accepted change evidence is missing or changed.');
    let result = {status: 'NOT_RUN', reason: 'No verification was recorded for this case in the earlier selection.', nextAction: 'Include the case in a reviewed selection and run verification.'};
    if (run?.receipt) {
      requireThat(run.gate === 'case-assertions', 'The earlier verification did not use the required case assertion gate.');
      if (!receipts.has(run.id)) {
        try {receipts.set(run.id, {receipt: nativeReceipt(roots, run, {...candidate, sourceId: handoff.source.id})});}
        catch {receipts.set(run.id, {issue: 'The earlier saved test result is missing, changed, or has a different case scope.'});}
      }
      const saved = receipts.get(run.id); requireThat(!saved.issue, saved.issue);
      const mapped = candidate.tests.find(test => test.scenarioId === scenario.id);
      result = nativeCase(saved.receipt.tests.find(test => identity(test) === identity(mapped)), run, 'PASS');
    } else if (run) result = {status: run.status === 'BLOCKED' ? 'BLOCKED' : run.status === 'STARTED' ? 'PENDING' : 'NEEDS_REVIEW',
      reason: run.reason ?? 'A case result is unavailable from the recorded verification.', nextAction: run.nextAction ?? 'Inspect the original verification and resolve its prerequisite before resuming.'};
    return {stage: 'VERIFY', ...result, historical: true, reason: `${candidate.revision === state.candidates.at(-1)?.revision ? 'Recorded verification' : 'Earlier selection'}: ${caseReason(result.reason)} This result alone does not establish readiness for the current automation selection.`,
      nextAction: result.nextAction ?? 'Include the case in the current selection and satisfy its review and verification requirements before counting it as ready.'};
  } catch {return needsReview('The earlier case requirements, approval, or saved test result no longer match the recorded verification. Its result requires review.');}
}

function observedCase(handoff, scenario) {
  if (!handoff?.source.scenarios.some(row => row.id === scenario.id && fingerprint(row) === fingerprint(scenario))) return [];
  return handoff.bindings.filter(binding => handoff.expectations.some(expected => expected.key === binding.key && expected.scenarioId === scenario.id))
    .flatMap(binding => handoff.observations.find(run => run.runId === binding.runId)?.scenarios.find(row => row.id === binding.scenarioId)?.attempts
      .flatMap(attempt => attempt.assertions.filter(row => row.id === binding.expectationId && row.reliable).map(row => row.status)) ?? []);
}

/** Read existing history only. Blocker notes cannot create verdicts, candidates or greens. */
export async function automationReportView(roots, {sourceId, source: sourceInput, notes, blocker, reporting: reportingInput} = {}) {
  if (blocker !== undefined) {
    blocker = data(blocker); keys(blocker, ['stage', 'reason', 'nextAction'], 'generation command blocker');
    const text = value => typeof value === 'string' && value.trim() && value.length <= 4096;
    requireThat(GENERATION_STAGES.includes(blocker.stage) && text(blocker.reason) && (blocker.nextAction === undefined || text(blocker.nextAction)), 'Command blockers need a known stage and a bounded reason.');
  }
  const supplied = sourceInput === undefined ? undefined : reportSource(sourceInput);
  sourceId ??= supplied?.id; id(sourceId);
  requireThat(!supplied || supplied.id === sourceId, 'Report source identity differs from generation.');
  return transaction(roots, sourceId, (state, _save, _directory, history) => {
    const selected = state ? validateLocalSource(state.handoff.source) : supplied;
    requireThat(selected, 'A valid source inventory is required before reporting.');
    requireThat(!supplied || fingerprint(supplied) === fingerprint(selected), 'Report source differs from recorded generation history.');
    const context = reportingInput ?? state?.reporting;
    const reporting = context === undefined ? undefined : reportingContext(selected, context, state?.reporting);
    requireThat(!state?.reporting || !reportingInput || state.reporting.sourceFingerprint === reporting.sourceFingerprint, 'Requested source differs from recorded reporting scope.');
    const source = reporting?.source ?? selected, retainedNotes = notes ?? reporting?.notes ?? state?.reporting?.notes;
    const readiness = state ? generationStateStatus(roots, state) : {status: 'NOT_STARTED', rounds: 0, greens: 0};
    const candidate = state?.candidates.at(-1), blockers = caseNotes(source, retainedNotes, [...(candidate?.tests.map(test => test.scenarioId) ?? []), ...(reporting?.observed?.cases.map(row => row.id) ?? [])]);
    let candidateIssue, approved = false;
    if (candidate) {
      try {currentCandidate(roots, state); approvedCandidate(roots, state); approved = true;}
      catch (error) {
        candidateIssue = generationBlocker(error, 'REVIEW');
        const review = state.reviews.filter(item => item.revision === candidate.revision).at(-1);
        const findings = review?.findings.filter(finding => finding.blocking && finding.resolution === 'open') ?? [];
        if (findings.length) candidateIssue = {stage: 'REVIEW', reason: findings.map(finding => `${finding.id}: ${finding.reason}`).join(' '), nextAction: 'Resolve the recorded review findings and obtain independent approval of the updated candidate.'};
      }
    }
    const runs = state?.runs.filter(run => run.revision === candidate?.revision) ?? [], latest = runs.at(-1);
    let receipt, receiptIssue;
    if (latest?.receipt) {
      try {receipt = nativeReceipt(roots, latest, {...candidate, sourceId});}
      catch {receiptIssue = 'The recorded native receipt is missing, changed, or has a different case scope. Case results are unavailable; review is required.';}
    }
    const historicalReceipts = new Map();
    const cases = source.scenarios.map(scenario => {
      const note = blockers.get(scenario.id), mapped = candidate?.tests.find(test => test.scenarioId === scenario.id);
      const inSelection = selected.scenarios.some(row => row.id === scenario.id);
      const assessment = reporting?.observed?.cases.find(row => row.id === scenario.id);
      const observedHandoff = [...history.handoffs.values()].reverse().find(handoff => handoff.source.scenarios.some(row => row.id === scenario.id && fingerprint(row) === fingerprint(scenario)));
      const observed = assessment ? [assessment.status] : observedCase(observedHandoff, scenario);
      const earlier = state?.candidates.findLast(item => item.revision !== candidate?.revision && item.tests.some(test => test.scenarioId === scenario.id));
      let disposition = {status: 'NOT_GENERATED', stage: state && inSelection ? 'AUTHOR' : 'EXPLORE', reason: 'No generated test candidate exists for this case.', nextAction: state && inSelection ? 'Author and register the case in a complete source candidate.' : 'Explore the source and prepare its observed generation handoff.'};
      if (note) disposition = {status: 'BLOCKED', stage: note.stage, reason: note.reason, ...(note.nextAction ? {nextAction: note.nextAction} : {}), declaredBlocker: true};
      else if (!mapped && (!scenario.steps.length || scenario.steps.some(step => !step.action.trim() || step.expected.some(value => !value.trim())) || !scenario.steps.some(step => step.expected.length))) {
        disposition = {status: 'BLOCKED', stage: 'REFINE', reason: 'The source case has incomplete actions or expected results.', nextAction: 'Clarify the original actions and accepted expected results before preparing generation.'};
      }
      else if (!mapped && earlier) disposition = historicalCase(roots, state, earlier, scenario, history.candidateHandoffs.get(earlier.revision), historicalReceipts);
      else if (!mapped && assessment) disposition = {status: 'NOT_GENERATED', stage: 'EXPLORE', reason: assessment.reason ?? `Exploration result: ${outcome(assessment.status).label}. No automated test has been recorded for this case.`, nextAction: assessment.nextAction ?? 'Review the recorded exploration result and resolve outstanding requirements before creating the automated test.'};
      else if (!candidate && inSelection && blocker) disposition = {...blocker, status: 'BLOCKED'};
      else if (mapped && candidateIssue) disposition = {status: 'NEEDS_REVIEW', ...candidateIssue};
      else if (mapped && approved) {
        disposition = {status: 'NOT_RUN', stage: 'VERIFY', reason: 'No scoped verification has been recorded for this candidate.', nextAction: 'Run the independently approved candidate through scoped verification.'};
        if (receiptIssue) disposition = {status: 'NEEDS_REVIEW', stage: 'VERIFY', reason: receiptIssue, nextAction: 'Reassess the original receipts and candidate integrity; do not infer a pass.'};
        else if (receipt) disposition = {stage: 'VERIFY', ...nativeCase(receipt.tests.find(test => identity(test) === identity(mapped)), latest, readiness.status)};
        else if (latest) disposition = {status: latest.status === 'BLOCKED' ? 'BLOCKED' : latest.status === 'STARTED' ? 'PENDING' : 'NEEDS_REVIEW', stage: latest.failureClass ? `VERIFY · ${latest.failureClass}` : 'VERIFY', reason: latest.reason ?? 'A case result is unavailable from the recorded verification.', nextAction: latest.nextAction ?? 'Inspect the original verification and resolve its prerequisite before resuming.'};
      }
      return {id: scenario.id, title: scenario.title, ...disposition, observedStatus: [...new Set(observed.filter(Boolean))].join(', ') || 'Not recorded',
        ...(assessment?.reason ? {observedReason: assessment.reason} : {}), ...(assessment?.nextAction ? {observedNextAction: assessment.nextAction} : {}),
        expectations: scenario.steps.flatMap(step => step.expected), history: (state?.runs ?? []).filter(run => state.candidates.find(item => item.revision === run.revision)?.tests.some(test => test.scenarioId === scenario.id))
          .map(run => {
            const previous = state.candidates.find(item => item.revision === run.revision);
            const origin = history.candidateHandoffs.get(previous.revision), original = origin?.source.scenarios.find(row => row.id === scenario.id);
            const result = historicalCase(roots, state, previous, original ?? scenario, origin, historicalReceipts, run);
            if (original && fingerprint(original) !== fingerprint(scenario)) result.reason = `Earlier case requirements: ${result.reason}`;
            return {id: run.id, revision: run.revision, status: run.status, ...(run.failureClass ? {failureClass: run.failureClass} : {}), ...(run.reason ? {reason: run.reason} : {}), ...(run.nextAction ? {nextAction: run.nextAction} : {}),
              caseStatus: result.status, caseReason: result.reason, caseStage: result.stage, ...(result.nextAction ? {caseNextAction: result.nextAction} : {})};
          })};
    });
    const coverage = {total: cases.length, selected: selected.scenarios.length, ready: cases.filter(row => row.status === 'READY').length,
      blocked: cases.filter(row => row.status === 'BLOCKED').length, scopeKnown: Boolean(reporting || !state)};
    coverage.complete = coverage.scopeKnown && coverage.ready === coverage.total;
    const discoveryRuns = [...(state?.handoff.observations ?? []), ...(reporting?.observed?.cases ?? [])];
    const dbDiscoveries = readDbDiscoverySummary(roots, {runIds: [...new Set(discoveryRuns.map(row => row.runId))], scenarioIds: source.scenarios.map(row => row.id)});
    const apiDiscoveries = [...new Set(discoveryRuns.map(row => row.runId))].map(runId => {
      const bindings = discoveryRuns.filter(row => row.runId === runId), runRoot = bindings[0].runRoot;
      if (!runRoot || bindings.some(row => row.runRoot !== runRoot || row.inputFingerprint !== bindings[0].inputFingerprint)) return {runId, candidates: [], gaps: ['discovery-summary-unavailable']};
      return readApiDiscoverySummary(roots, runRoot, runId);
    }).filter(row => row.candidates.length || row.gaps.length);
    const observed = reporting?.observed && data({version: reporting.observed.version, source: reporting.observed.source, cases: reporting.observed.cases.map(({runRoot, ...row}) => row)});
    if (observed) observed.fingerprint = fingerprint(observed);
    return frozen(data({version: 1, id: `automation-${randomUUID()}`, workflow: 'automate-test', sourceId, title: source.title,
      createdAt: new Date().toISOString(), sourceFingerprint: fingerprint(source), selectedSourceFingerprint: fingerprint(selected), status: readiness.status, rounds: readiness.rounds, greens: readiness.greens,
      environment: [...new Set([...(state?.handoff.observations ?? []).map(run => run.environment), ...(reporting?.observed?.cases ?? []).map(row => row.environment)].filter(Boolean))].join(', ') || 'Not recorded',
      ...(blocker ? {blocker} : {}), coverage, cases, source, ...(apiDiscoveries.length ? {apiDiscoveries} : {}), ...(dbDiscoveryLines(dbDiscoveries).length ? {dbDiscoveries} : {}), ...(retainedNotes ? {notes: retainedNotes} : {}), ...(observed ? {observed} : {})}, 8 * 1024 * 1024, {maxNodes: 200000}));
  });
}

/** Companion text uses the same collected case outcomes; it never files product bugs. */
export function automationCompanions(view) {
  const describe = row => `## ${md(row.id)} — ${md(outcome(row.status).label)}\n\n${md(row.title)}\n\nStage: ${md(stageLabel(row.stage))}\n\nExploration result: ${md(row.observedStatus ?? 'Not recorded')}\n\nReason: ${md(caseReason(row.reason) || 'Reason unavailable; investigation is needed.')}\n\n${row.nextAction ? `Next action: ${md(caseReason(row.nextAction))}\n\n` : ''}${row.observedReason && row.observedReason !== row.reason ? `Exploration reason: ${md(caseReason(row.observedReason))}\n\n` : ''}${row.observedNextAction && row.observedNextAction !== row.nextAction ? `Exploration next action: ${md(caseReason(row.observedNextAction))}\n\n` : ''}${row.history?.length ? `Recorded verification:\n\n${row.history.map(run => `- ${md(outcome(run.caseStatus).label)}: ${md(caseReason(run.caseReason))}${run.caseNextAction ? ` Next action: ${md(caseReason(run.caseNextAction))}` : ''}`).join('\n')}\n\n` : ''}`;
  const attention = view.cases.filter(caseNeedsAttention);
  const coverage = automationCoverageText(view);
  return [
    ['summary.md', `# ${md(view.title)}\n\n${md(coverage)}\n\n${view.cases.map(describe).join('')}${view.dbDiscoveries ? `\n## Database query knowledge\n\n${dbDiscoveryLines(view.dbDiscoveries).map(md).join('\n\n')}\n` : ''}`],
    ['defects.md', `# Defects and cases needing attention\n\n${md(coverage)}\n\nThese are recorded failures, blockers and review findings, not filed product bugs.\n\n${attention.map(describe).join('') || 'No cases currently need attention.\n'}`]
  ];
}

/** Fresh consumer output, with a final integrity manifest and a separate delivery outcome. */
export async function writeAutomationReport(roots, options = {}) {
  try {
    const view = await automationReportView(roots, options), {directory, path: output} = timestampedReportDirectory(roots, {parent: 'reports/harness', prefix: 'automation-', at: view.createdAt});
    const files = [['result.json', JSON.stringify(view, null, 2) + '\n'], ...automationCompanions(view), ['index.html', renderAutomationHtml(view)]];
    const artifacts = files.map(([name, body]) => {writeFileSync(join(output, name), body, {flag: 'wx', mode: 0o600}); return {path: name, bytes: Buffer.byteLength(body), sha256: digest(body)};});
    const manifest = {version: 1, status: 'WRITTEN', sourceId: view.sourceId, sourceFingerprint: view.sourceFingerprint, readiness: view.status, coverage: view.coverage, cases: view.cases.length, artifacts};
    writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});
    return {...manifest, directory, html: `${directory}/index.html`, ...(view.apiDiscoveries ? {apiDiscoveries: view.apiDiscoveries} : {}), ...(view.dbDiscoveries ? {dbDiscoveries: view.dbDiscoveries} : {})};
  } catch {return {status: 'FAILED', reason: 'Automation report input, integrity validation or delivery failed; generation history and verdicts are unchanged.'};}
}
