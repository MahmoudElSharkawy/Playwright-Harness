// M15 evidence assessment only. Existing runtimes, generation gates and reporters keep their responsibilities.
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {consumerPath} from './consumer-paths.mjs';
import {within} from './skill-roots.mjs';
import {createRun, assessRun} from './execution-core/index.mjs';
import {data, digest, fingerprint, requireThat, unique} from './execution-core/data.mjs';
import {executionSemantics} from './host-parity.mjs';
import {createGenerationHandoff, sourceExpectations, generationStatus, approvedCandidate} from './generation/index.mjs';
import {transaction} from './generation/storage.mjs';
import {selectTests, assessVerification} from './generation/verify.mjs';
import {allureInventory} from './reporting/allure.mjs';
import {reportView, renderJson, renderMarkdown, renderHtml} from './reporting/index.mjs';

const same = (left, right, message) => requireThat(fingerprint(left) === fingerprint(right), message);
const read = (roots, path) => data(JSON.parse(readFileSync(consumerPath(roots, path), 'utf8')));
const raw = (roots, path) => readFileSync(consumerPath(roots, path));
function executionRecords(roots, path) {
  const bytes = raw(roots, path); requireThat(bytes.length <= 32 * 1024 * 1024, 'Workflow execution inventory exceeds bounds.');
  const records = JSON.parse(bytes); requireThat(Array.isArray(records) && records.length <= 500, 'Invalid workflow execution inventory.');
  // The execution-core bound applies to each run, not the complete multi-run proof.
  return records.map(record => data(record));
}
const exactScope = (actual, expected, label) => {
  requireThat(Array.isArray(expected) && expected.length > 0, `${label} needs nonempty expected scope.`); unique(expected, label);
  same(actual, expected, `${label} is missing, duplicated or reordered.`);
};

/** Refine the unchanged source before any exploration or mutation is dispatched. */
export function workflowRefinement(source, refinement) {
  const expectations = sourceExpectations(source), sourceFingerprint = fingerprint(source);
  requireThat(refinement?.version === 1 && refinement.sourceFingerprint === sourceFingerprint, 'Refinement refers to another source.');
  exactScope(refinement.scenarios?.map(s => s.id), source.scenarios.map(s => s.id), 'Refinement');
  for (const scenario of refinement.scenarios) {
    exactScope(scenario.expectationKeys, expectations.filter(e => e.scenarioId === scenario.id).map(e => e.key), 'Refined expectations');
    requireThat(typeof scenario.notes === 'string' && scenario.notes.trim().length > 0, 'Refinement needs an explicit implementation note.');
  }
  return refinement.scenarios.map(s => ({id: s.id, expectationKeys: s.expectationKeys}));
}

/** Notes refer to original source positions and assessed current-run evidence. They cannot become a new oracle. */
export function workflowNotes(source, handoff, refinement, candidates) {
  const refined = workflowRefinement(source, refinement), expectations = sourceExpectations(source);
  requireThat(candidates?.version === 1 && candidates.status === 'UNREVIEWED', 'Knowledge must remain an unreviewed candidate.');
  requireThat(candidates.sourceFingerprint === fingerprint(source), 'Knowledge refers to another source.');
  exactScope(candidates.facts?.map(f => f.key), expectations.map(e => e.key), 'Knowledge candidates');
  const facts = candidates.facts.map(fact => {
    const binding = handoff.bindings.find(b => b.key === fact.key), observation = handoff.observations.find(o => o.runId === binding?.runId);
    const scenario = observation?.scenarios.find(s => s.id === binding.scenarioId);
    const assertions = scenario?.attempts.flatMap(a => a.assertions).filter(a => a.id === binding.expectationId && a.reliable) ?? [];
    requireThat(assertions.length > 0 && fact.runId === binding.runId && fact.scenarioId === expectations.find(e => e.key === fact.key).scenarioId, 'Knowledge lineage does not identify the observed assertion.');
    const evidenceIds = [...new Set(assertions.flatMap(a => a.evidenceIds))].sort();
    exactScope([...fact.evidenceIds].sort(), evidenceIds, 'Knowledge evidence');
    same(fact.assertionStatuses, assertions.map(a => a.status), 'Knowledge changed the observed assertion outcome.');
    return {key: fact.key, scenarioId: fact.scenarioId, assertionStatuses: fact.assertionStatuses, evidenceKinds: evidenceIds.map(id => observation.evidence.find(e => e.id === id)?.kind).sort()};
  });
  return {source, refinement: refined, knowledge: {status: candidates.status, facts}};
}

function checkedExecution(record, roots) {
  requireThat(record.roots.packageRoot === roots.packageRoot && within(roots.projectRoot, record.roots.projectRoot) && within(roots.projectRoot, record.roots.runRoot), 'Execution belongs to another consumer/package.');
  requireThat(consumerPath(roots, relative(roots.projectRoot, record.roots.runRoot)) === record.roots.runRoot, 'Execution path redirects.');
  const run = createRun({id: record.run.id, startedAt: record.run.startedAt, ...record.run.inputs});
  same(run, record.run, 'Frozen execution changed.');
  const result = assessRun(run, record.roots, record.observations); same(result, record.result, 'Recorded execution outcome changed.');
  return {result, semantic: executionSemantics(record)};
}

/** Every report is checked against its own assessed result and bytes before nondeterminism is removed. */
export function checkExecutionReport(roots, directory, result) {
  const view = reportView(result), manifest = read(roots, `${directory}/manifest.json`);
  requireThat(manifest.status === 'WRITTEN' && manifest.runId === result.runId && manifest.verdict === result.status && manifest.stability === result.stability && manifest.reportFingerprint === view.fingerprint, 'Report contradicts its execution.');
  const expected = [['result.json', renderJson(view)], ['report.md', renderMarkdown(view)], ['index.html', renderHtml(view)]];
  exactScope(manifest.artifacts?.map(a => a.path), expected.map(([path]) => path), 'Report artifacts');
  for (const [path, body] of expected) {
    const bytes = raw(roots, `${directory}/${path}`), artifact = manifest.artifacts.find(a => a.path === path);
    requireThat(bytes.length === artifact.bytes && digest(bytes) === artifact.sha256 && bytes.equals(Buffer.from(body)), 'Report bytes or integrity metadata changed.');
  }
  return {status: result.status, stability: result.stability, formats: expected.map(([path]) => path)};
}

function checkArtifact(roots, artifact, expectedPath) {
  requireThat(artifact?.path === expectedPath, 'Report artifact association changed.');
  const bytes = raw(roots, artifact.path);
  requireThat(bytes.length > 0 && bytes.length === artifact.bytes && digest(bytes) === artifact.sha256, 'Report artifact integrity failed.'); return bytes;
}
const attachments = (step, depth = 0) => [...(step.attachments ?? []).map(a => ({...a, depth})), ...(step.steps ?? []).flatMap(s => attachments(s, depth + 1))];
const renderedAttachments = (step, depth = 0) => [...(step.type === 'attachment' ? [{...step.link, depth}] : []), ...(step.steps ?? []).flatMap(s => renderedAttachments(s, depth + 1))];

/** Pin-specific Allure rendering evidence; never execute embedded scripts or use report status as readiness. */
export function checkWorkflowAllure(roots, verification, tests, generated) {
  const directory = verification.reporting?.directory;
  requireThat(verification.reporting?.status === 'CAPTURED' && directory === `reports/generation/${verification.id}`, 'Missing or misassociated Allure capture.');
  const capture = read(roots, `${directory}/capture.json`), receipt = read(roots, `${directory}/generation.json`), reference = read(roots, `${directory}/verification.json`);
  requireThat(capture.status === 'CAPTURED' && capture.tests === tests.length && capture.nativeStatus === 'passed', 'Allure scope or native status changed.');
  same(allureInventory(consumerPath(roots, `${directory}/allure-results`)), capture.artifacts, 'Allure captured files changed.');
  same(reference, {sourceId: verification.sourceId, invocation: verification.id, revision: verification.revision, status: verification.status}, 'Allure verifier reference changed.');
  requireThat(receipt.status === 'GENERATED' && receipt.generator === 'allure' && receipt.commandline === '3.19.1' && receipt.tests === tests.length && receipt.reporter === '3.13.0', 'Unsupported or incomplete Allure generation.');
  requireThat(receipt.configuration === digest(readFileSync(join(roots.packageRoot, 'scripts/lib/reporting/allurerc.json'))), 'Allure configuration changed.');
  same(receipt.verification, {id: verification.id, revision: verification.revision, status: verification.status}, 'Allure generation belongs to another verifier.');
  const landing = checkArtifact(roots, receipt.artifact, `${directory}/index.html`).toString();
  requireThat(landing.includes(`Recorded outcome: <strong>${verification.status}</strong>`), 'Verifier outcome missing from landing page.');
  const html = checkArtifact(roots, receipt.nativeArtifact, `${directory}/allure-report/index.html`).toString();
  requireThat(html.includes('Content-Security-Policy'), 'Offline report policy missing.');
  const inline = new Map([...html.matchAll(/\bd\(("(?:[^"\\]|\\.)*"),("(?:[^"\\]|\\.)*")\)/g)].map(m => [JSON.parse(m[1]), Buffer.from(JSON.parse(m[2]), 'base64')]));
  const results = capture.artifacts.filter(a => a.path.endsWith('-result.json')).map(a => read(roots, `${directory}/allure-results/${a.path}`));
  const rendered = [...inline].filter(([path]) => /^data\/test-results\/.+\.json$/.test(path)).map(([, bytes]) => JSON.parse(bytes));
  requireThat(results.length === tests.length && rendered.length === tests.length, 'Native or rendered Allure scope changed.');
  return tests.map(test => {
    const matching = results.filter(r => r.name === test.titlePath.at(-1)); requireThat(matching.length === 1 && matching[0].status === 'passed', 'Native Allure test missing, duplicated or failed.');
    const converted = rendered.filter(r => r.name === test.titlePath.at(-1)); requireThat(converted.length === 1 && converted[0].status === 'passed', 'Rendered Allure test missing, duplicated or failed.');
    const execution = generated.find(e => e.id === test.scenarioId), names = [];
    if (execution) {
      const view = reportView(execution.result);
      for (const [name, type, body] of [['Harness execution result', 'application/json', renderJson(view)], ['Harness execution report', 'text/html', renderHtml(view)]]) {
        const found = attachments(matching[0]).filter(a => a.name === name); requireThat(found.length === 1 && found[0].type === type && found[0].depth >= 2, 'Harness attachment is missing, duplicated or outside its technical step.');
        const bytes = raw(roots, `${directory}/allure-results/${found[0].source}`);
        const links = renderedAttachments(converted[0]).filter(a => a.name === name);
        requireThat(links.length === 1 && links[0].missed === false && links[0].depth >= 3 && links[0].contentType === type, 'Rendered attachment lost its test or technical-step association.');
        const embedded = inline.get(`data/attachments/${links[0].id}${links[0].ext}`);
        requireThat(bytes.equals(Buffer.from(body)) && embedded?.equals(bytes), 'Native or embedded attachment content differs from the assessed result.');
        names.push({name, type});
      }
    }
    return {scenarioId: test.scenarioId, status: matching[0].status, attachments: names};
  });
}

/** Reconstruct the complete fixed proof. Missing stages never collapse into two equal empty runs. */
export async function workflowSemantics(roots, {source, executionIds, generatedIds}) {
  same(read(roots, 'source.json'), source, 'Source changed after preparation.');
  same(read(roots, '.harness/workflow/refinement-receipt.json'), {version: 1, phase: 'BEFORE_EXPLORATION', sourceFingerprint: fingerprint(source), sha256: digest(raw(roots, 'refinement.json'))}, 'Pre-exploration refinement changed or is missing.');
  const executions = executionRecords(roots, '.harness/workflow/exploration.json'); exactScope(executions.map(c => c.id), executionIds, 'Exploration');
  unique(executions.map(c => c.run.id), 'Exploration runs');
  const status = await generationStatus(roots, source.id); requireThat(status.status === 'READY' && status.greens === 2, 'Workflow is not delivery ready.');
  return transaction(roots, source.id, state => {
    const candidate = approvedCandidate(roots, state);
    same(state.handoff.source, source, 'Handoff source changed.');
    const handed = executions.filter(e => state.handoff.bindings.some(b => b.runId === e.run.id))
      .map(e => ({...e, run: createRun({id: e.run.id, startedAt: e.run.startedAt, ...e.run.inputs})}));
    same(createGenerationHandoff(source, handed, state.handoff.bindings), state.handoff, 'Handoff no longer matches original evidence.');
    const notes = workflowNotes(source, state.handoff, read(roots, 'refinement.json'), read(roots, '.harness/knowledge-candidates/workflow.json'));
    const exploration = executions.map(record => {const checked = checkedExecution(record, roots); return {id: record.id, execution: checked.semantic, reporting: checkExecutionReport(roots, `reports/exploration/${record.id}`, checked.result)};});
    const runs = state.runs.filter(r => r.revision === candidate.revision); requireThat(runs.length === 2 && runs.every(r => r.status === 'PASS'), 'Two scoped green processes are required.'); unique(runs.map(r => r.id), 'Verification invocations');
    const runtimeIds = [];
    const verification = runs.map(run => {
      const receipt = read(roots, run.receipt.path), collection = read(roots, `.harness/state/generation/${source.id}/${run.id}/collection.json`);
      requireThat(collection.invocation === run.id && fingerprint(receipt) === run.receipt.fingerprint, 'Native receipt identity or integrity changed.');
      const selected = selectTests(candidate, collection); assessVerification(state.handoff, selected, receipt, run.id, 0);
      const directory = `.harness/workflow/generated/${run.id}`;
      const paths = readdirSync(consumerPath(roots, directory)); same([...paths].sort(), generatedIds.map(id => `${id}.json`).sort(), 'Generated runtime coverage changed.');
      const generated = generatedIds.map(id => {
        const record = read(roots, `${directory}/${id}.json`); requireThat(record.id === id && record.invocation === run.id, 'Generated operation belongs to another test/invocation.');
        runtimeIds.push(record.execution.run.id); const checked = checkedExecution(record.execution, roots);
        requireThat(record.reporting.directory === `reports/execution/${run.id}/${id}`, 'Generated report association changed.');
        return {id, ...checked, reporting: checkExecutionReport(roots, record.reporting.directory, checked.result)};
      });
      return {status: run.status, gate: receipt.version === 1 ? 'source-expectations' : 'case-assertions', expectations: sourceExpectations(source),
        tests: selected.map(test => {
          const result = receipt.tests.find(t => t.id === test.id).results[0];
          return {scenarioId: test.scenarioId, assertions: receipt.version === 1
            ? {evaluated: result.expectations.every(e => e.assertions > 0), failed: result.expectations.some(e => e.failed)}
            : {evaluated: result.assertions.passed > 0, failed: result.assertions.failed > 0}, skipped: receipt.version === 2 && result.skippedSteps > 0};
        }),
        executions: generated.map(g => ({id: g.id, execution: g.semantic, reporting: g.reporting})),
        allure: checkWorkflowAllure(roots, {...run, sourceId: source.id}, candidate.tests, generated)};
    });
    unique(runtimeIds, 'Generated runtime invocations');
    return {notes, exploration, verification, readiness: {status: status.status, greens: status.greens}};
  });
}

export async function compareWorkflows(left, right, expected) {
  const a = await workflowSemantics(left, expected), b = await workflowSemantics(right, expected);
  const stages = ['notes', 'exploration', 'verification', 'readiness'].map(stage => ({stage, equivalent: fingerprint(a[stage]) === fingerprint(b[stage])}));
  return {status: stages.every(s => s.equivalent) ? 'PASS' : 'FAIL', scenarios: expected.source.scenarios.length, explorationCases: expected.executionIds.length, generatedOperationsPerRun: expected.generatedIds.length, stages};
}
