import {consumerPath} from '../consumer-paths.mjs';
import {data, digest, fingerprint, keys, requireThat} from '../execution-core/data.mjs';
import {readBounded} from '../execute/storage.mjs';
import {collectExecution, executionDefects, deliverableDefects} from '../execute/report.mjs';
import {automationReportView} from '../generation/report.mjs';
import {readReportingObservations} from '../generation/reporting-context.mjs';
import {adoStoryToSource, adoSuiteToSource} from '../integrations/ado-source.mjs';
import {jiraCasesToSource} from '../integrations/jira-source.mjs';
import {jiraFetchScope} from '../integrations/compatibility.mjs';

function adoReference(scenario, snapshot) {
  const refs = (scenario.externalReferences ?? []).filter(ref => ref.system.toLowerCase() === 'ado');
  if (!refs.length) return {references: [], sourceGaps: []};
  const gap = {references: [], sourceGaps: ['Original ADO case/story/shared-source revisions are unavailable; select the pre-execution revision snapshot.']};
  if (!snapshot) return gap;
  const neutral = snapshot.storyId ? adoStoryToSource(snapshot) : adoSuiteToSource(snapshot), references = [];
  for (const ref of refs) {
    const original = neutral.scenarios.find(row => row.externalReferences.some(item => item.id === ref.id)), tc = snapshot.cases.find(row => String(row.id) === ref.id);
    requireThat(original && fingerprint({title: original.title, steps: original.steps}) === fingerprint({title: scenario.title, steps: scenario.steps}), 'Original ADO snapshot does not match the executed automation source.');
    const sharedIds = [...new Set(tc.steps.map(step => step.fromShared).filter(Boolean))], sharedSteps = tc.sharedRevisions ?? {};
    if (!Number.isSafeInteger(tc.rev) || tc.rev < 1 || sharedIds.some(id => !Number.isSafeInteger(sharedSteps[id])) || snapshot.storyId && !Number.isSafeInteger(snapshot.storyRev)) return gap;
    references.push({caseId: tc.id, ado: {organizationUrl: snapshot.organizationUrl, project: snapshot.project,
      cases: [{id: tc.id, rev: tc.rev, sharedIds: Object.keys(sharedSteps).map(Number)}], sharedSteps,
      ...(snapshot.storyId ? {storyId: snapshot.storyId, storyRev: snapshot.storyRev} : {})}});
  }
  return {references, sourceGaps: []};
}

function jiraReference(scenario, snapshot) {
  const refs = (scenario.externalReferences ?? []).filter(ref => ['xray', 'zephyr-scale'].includes(ref.system.toLowerCase()));
  if (!refs.length) return {references: [], sourceGaps: []};
  const gap = {references: [], sourceGaps: ['Original Jira test and story versions are unavailable; select the pre-execution fetch manifest with jiraSnapshot.']};
  if (!snapshot) return gap;
  requireThat(snapshot.provider === 'jira' && snapshot.sourceFingerprint === digest(JSON.stringify(jiraFetchScope(snapshot))), 'Original Jira manifest fingerprint changed.');
  const neutral = jiraCasesToSource(snapshot.cases, snapshot), references = [];
  for (const ref of refs) {
    const index = neutral.scenarios.findIndex(row => row.externalReferences.some(item => item.system === ref.system && item.id === ref.id));
    const original = neutral.scenarios[index], tc = snapshot.cases[index];
    requireThat(original && fingerprint({title: original.title, steps: original.steps, externalReferences: original.externalReferences}) === fingerprint({title: scenario.title, steps: scenario.steps, externalReferences: scenario.externalReferences}), 'Original Jira snapshot does not match the executed automation source.');
    if (snapshot.selection.kind === 'story' && (!snapshot.story || snapshot.story.id !== snapshot.selection.id)) return gap;
    references.push({provider: 'jira', caseId: tc.id, jira: {scope: {kind: 'jira', siteUrl: snapshot.siteUrl, project: snapshot.project, projectId: snapshot.projectId, testManagement: snapshot.testManagement, selection: snapshot.selection},
      cases: [{id: tc.id, nativeId: tc.nativeId, revision: tc.revision, nativeFingerprint: tc.fingerprint}], ...(snapshot.story ? {story: snapshot.story} : {}), externalReferences: original.externalReferences}});
  }
  return {references, sourceGaps: []};
}
function nativeReferences(scenario, adoSnapshot, jiraSnapshot) {
  const ado = adoReference(scenario, adoSnapshot), jira = jiraReference(scenario, jiraSnapshot);
  return {references: [...ado.references, ...jira.references], sourceGaps: [...ado.sourceGaps, ...jira.sourceGaps]};
}

/** Reassess native records before the agent classifies failures. No ADO or test execution. */
export async function reviewRunFailures(roots, input) {
  const run = data(input); let source, findings, binding;
  if (run.workflow === 'execute-test') {
    keys(run, ['workflow', 'executionId'], 'execution bug review');
    const view = collectExecution(roots, run.executionId), deliverable = deliverableDefects(view).defects, eligible = new Map(deliverable.map(row => [row.fingerprint, row]));
    source = view.source;
    binding = {source: view.execution.sourceFingerprint, freeze: view.execution.freezeFingerprint ?? null,
      runs: view.scenarios, integrityFailures: view.integrityFailures};
    findings = executionDefects(view).map(defect => {
      const scenario = source.scenarios.find(row => row.id === defect.scenarioId);
      const selected = eligible.get(defect.fingerprint);
      const references = selected ? [{executionId: run.executionId, caseId: defect.caseId, sourceFingerprint: view.execution.sourceFingerprint,
        defectFingerprint: defect.fingerprint, observationsFingerprint: fingerprint(selected.occurrences)}] : [];
      const evidence = defect.occurrences.flatMap(occurrence => {
        const observed = view.runs.find(row => row.runId === occurrence.runId);
        return (observed?.result?.evidence ?? []).filter(record => occurrence.evidenceIds.includes(record.id)).map(record => ({
          path: `.harness/runs/${run.executionId}/${occurrence.runId}/${record.path}`, sha256: record.sha256, kind: record.kind, sanitized: record.sanitized === true,
          context: `Case ${defect.caseId}; run ${occurrence.runId}; evidence ${record.id}`
        }));
      });
      return {id: defect.fingerprint, caseId: defect.caseId, scenarioId: defect.scenarioId, title: defect.title, status: defect.status,
        eligible: eligible.has(defect.fingerprint) && !view.integrityFailures.length,
        steps: scenario.steps.map(row => row.action), expected: scenario.steps.flatMap(row => row.expected),
        occurrences: defect.occurrences, references, evidence};
    });
    for (const row of view.scenarios.filter(row => !['PASS', 'SKIPPED'].includes(row.status ?? row.state) && !findings.some(finding => (finding.occurrences ?? []).some(occurrence => occurrence.scenarioId === row.id)))) {
      findings.push({id: `case-${row.id}`, caseId: row.caseId, scenarioId: row.id, title: row.title, status: row.status ?? row.state,
        eligible: false, reason: row.reason ?? 'No supported application failure was established.', references: [], evidence: []});
    }
  } else {
    requireThat(run.workflow === 'automate-test', 'Select execute-test or automate-test for failure review.');
    keys(run, ['workflow', 'sourceId', 'source', 'notes', 'observed', 'adoSnapshot', 'jiraSnapshot'], 'automation bug review');
    const observed = run.observed ? readReportingObservations(roots, run.observed) : null;
    const view = await automationReportView(roots, {...(run.sourceId ? {sourceId: run.sourceId} : {}),
      ...(run.source ? {source: readBounded(consumerPath(roots, run.source))} : {}),
      ...(run.notes ? {notes: readBounded(consumerPath(roots, run.notes))} : {}),
      ...(observed ? {reporting: {source: observed.assessment.source, observed: observed.assessment}} : {})});
    source = view.source;
    const adoSnapshot = run.adoSnapshot ? readBounded(consumerPath(roots, run.adoSnapshot)) : null;
    const jiraSnapshot = run.jiraSnapshot ? readBounded(consumerPath(roots, run.jiraSnapshot)) : null;
    binding = {sourceId: view.sourceId, selectedSourceFingerprint: view.selectedSourceFingerprint, status: view.status, rounds: view.rounds, greens: view.greens, environment: view.environment, cases: view.cases, observations: observed?.fingerprint ?? null};
    const failed = row => row.status === 'FAIL' || row.observedStatus.split(', ').includes('FAIL') || row.history.some(previous => previous.caseStatus === 'FAIL');
    findings = view.cases.filter(row => failed(row) || !['PASS', 'READY', 'SKIPPED'].includes(row.status)).map(row => {
      const scenario = source.scenarios.find(item => item.id === row.id);
      return {id: `generation-${fingerprint({source: source.id, caseId: row.id}).slice(0, 20)}`, caseId: row.id, scenarioId: row.id, title: row.title,
        status: row.status, eligible: failed(row), reason: row.reason, observedStatus: row.observedStatus, history: row.history,
        steps: scenario.steps.map(step => step.action), expected: row.expectations, ...nativeReferences(scenario, adoSnapshot, jiraSnapshot), evidence: []};
    });
  }
  const review = data({version: 1, run, source, binding, findings});
  return {...review, hash: fingerprint(review)};
}
