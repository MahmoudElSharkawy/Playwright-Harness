import {existsSync, readFileSync, writeFileSync, openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {assessRun} from '../execution-core/index.mjs';
import {fingerprint, digest, requireThat} from '../execution-core/data.mjs';
import {reportDirectory, writeReports} from '../reporting/index.mjs';
import {escapeHtml} from '../reporting/render.mjs';
import {readFrozen, readBounded, ownedFile, listRunRecords} from './storage.mjs';
import {restoreRun, deleteLogin} from './host.mjs';
import {aggregateSourceConditions, ASSERTION_BYTES, compareRead, matchingRead, coverageAllows} from './verdicts.mjs';

export const markdownText = value => String(value).replace(/\r?\n/g, ' ').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
export function diagnosticSignature(text, {bindings = {}, values = []} = {}) {
  const replacements = new Map();
  const add = (value, placeholder) => {if (typeof value === 'string' && value.trim()) for (const form of [value, encodeURIComponent(value)]) if (!replacements.has(form)) replacements.set(form, placeholder);};
  for (const value of Object.values(bindings)) add(value, '<parameter>');
  for (const value of values) add(value, '<value>');
  let signature = String(text).replace(/https?:\/\/[^/\s<>"']+/g, '<origin>');
  if (replacements.size) {
    const alternatives = [...replacements.keys()].sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    signature = signature.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'gu'), value => replacements.get(value));
  }
  return signature.replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi, '<id>').replace(/\b\d+\b/g, '#');
}
export function readVerifiedEvidence(roots, record) {
  const handle = openSync(join(roots.runRoot, record.path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(handle); requireThat(stat.isFile() && stat.size === record.bytes, 'Registered evidence changed during reading.');
    const bytes = Buffer.alloc(record.bytes + 1); let length = 0, count;
    while (length < bytes.length && (count = readSync(handle, bytes, length, bytes.length - length, length)) > 0) length += count;
    requireThat(length === record.bytes && fstatSync(handle).size === record.bytes && digest(bytes.subarray(0, length)) === record.sha256, 'Registered evidence changed during reading.'); return bytes.subarray(0, length);
  } finally {closeSync(handle);}
}
export function defectFingerprint(source, item) {
  const canonical = {v: 1, org: source.organizationUrl, project: source.project, caseId: item.caseId, kind: item.kind, sourceStep: item.sourceStep,
    ...(item.kind === 'expectation' ? {expectedIndex: item.expectedIndex, conditionIndex: item.conditionIndex, conditionTemplate: item.conditionTemplate} : {signature: item.signature})};
  return `harness-defect-${fingerprint(canonical).slice(0, 12)}`;
}
function conditionRecords(result, roots, scenario) {
  const conditions = [], diagnostics = [], parsed = new Map();
  // A single verified byte buffer supplies both comparisons and diagnostics.
  const read = record => {if (!parsed.has(record.id)) parsed.set(record.id, JSON.parse(readVerifiedEvidence(roots, record).toString('utf8'))); return parsed.get(record.id);};
  for (const step of scenario.steps) for (const contract of step.contracts) {
    const attempts = result.scenarios[0].attempts.filter(attempt => attempt.identity.invocationId === step.id);
    const pairs = attempts.map(attempt => ({attempt, assertion: attempt.assertions.find(item => item.id === contract.id)})).filter(pair => pair.assertion);
    const pair = pairs.find(pair => pair.assertion.status === 'FAIL' && pair.assertion.reliable) ?? pairs.at(-1);
    let provenance = null, method = 'unresolved';
    if (pair) {
      if (step.family !== 'browser' && ['PASS', 'FAIL'].includes(pair.assertion.status)) method = 'checked';
      for (const evidenceId of step.family === 'browser' ? pair.assertion.evidenceIds : []) {
        const record = result.evidence.find(item => item.id === evidenceId && item.kind === 'assertion'); if (!record) continue;
        requireThat(record.bytes <= ASSERTION_BYTES, 'Assertion evidence exceeds its bound.');
        const value = read(record);
        if (['execute-assertion/1', 'execute-assertion/2'].includes(value.schema)) {
          requireThat(fingerprint(value.contract) === fingerprint(contract), 'Assertion contract differs from frozen source.'); provenance = value; method = value.method;
          if (value.schema === 'execute-assertion/2') for (const comparison of value.results) {
            if (comparison.method === 'checked') requireThat(comparison.read?.artifactId && comparison.read.digest, 'Checked browser evidence has no verified read provenance.');
            if (!comparison.read?.artifactId) continue;
            const artifact = result.evidence.find(item => item.id === comparison.read.artifactId);
            requireThat(artifact?.kind === 'observation' && pair.attempt.evidenceIds.includes(artifact.id), 'Read artifact is not associated with its assertion attempt.');
            const observed = read(artifact);
            requireThat(fingerprint(observed) === comparison.read.digest && observed.readKind === comparison.read.kind && fingerprint(observed.subject) === fingerprint(comparison.read.subject), 'Read provenance changed.');
            const observedRead = {...comparison.read, value: observed.actual, coverage: observed.coverage};
            const passed = compareRead(contract.condition, observedRead, comparison.supplied, comparison.exact);
            requireThat(comparison.matching === matchingRead(contract.condition, observedRead, comparison.expected, comparison.supplied, comparison.exact), 'Comparison binding changed.');
            requireThat(comparison.status === (coverageAllows(contract.condition, observedRead, passed) ? passed ? 'PASS' : 'FAIL' : 'INDETERMINATE'), 'Comparison differs from verified read.');
          }
        }
      }
    }
    conditions.push({stepId: step.id, family: step.family, legacy: provenance?.schema === 'execute-assertion/1', ...contract, status: pair?.assertion.status ?? 'NOT_EVALUATED', method, provenance,
      evidenceIds: pair?.assertion.evidenceIds ?? []});
  }
  for (const record of result.evidence.filter(item => item.kind === 'observation' && item.bytes <= 256 * 1024)) {
    let value; try {value = read(record);} catch (error) {if (error instanceof SyntaxError) continue; throw error;}
    if (Array.isArray(value.diagnostics)) {
      const step = scenario.steps.find(item => item.id === record.identity.invocationId), assertions = result.evidence.filter(item => item.kind === 'assertion' && item.identity.attemptId === record.identity.attemptId).map(read);
      const legacy = step?.family === 'browser' && (!assertions.length || assertions.some(item => item.schema !== 'execute-assertion/2'));
      diagnostics.push({stepId: record.identity.invocationId, evidenceId: record.id, entries: value.diagnostics, family: step?.family ?? null, legacy});
    }
  }
  return {conditions, diagnostics};
}
/** Always re-create and reassess. result.json is deliberately never consulted. */
export function collectExecution(roots, executionId) {
  const loaded = readFrozen(roots, executionId), runs = [];
  for (const snapshot of listRunRecords(roots, executionId)) {
    const runRoots = {...roots, runRoot: ownedFile(roots, executionId, snapshot.runId)}, observationsFile = join(runRoots.runRoot, 'observations.json');
    let row = {runId: snapshot.runId, scenarioId: snapshot.scenarioId, startedAt: snapshot.input.startedAt, explicitRerun: snapshot.explicitRerun, state: existsSync(runRoots.runRoot) ? 'INTERRUPTED' : 'NOT_RUN'};
    try {
      const run = restoreRun(snapshot, loaded);
      if (existsSync(observationsFile)) {
        const result = assessRun(run, runRoots, readBounded(observationsFile, 8 * 1024 * 1024)), scenario = loaded.freeze.scenarios.find(item => item.id === snapshot.scenarioId);
        row = {...row, state: 'ASSESSED', result, roots: runRoots, ...conditionRecords(result, runRoots, scenario)};
      }
    } catch {row = {...row, state: 'INTEGRITY_FAILURE', reason: 'INTEGRITY FAILURE (no verdict)'};}
    runs.push(row);
  }
  const runOrder = new Map(loaded.execution.runs.map((run, index) => [run.runId, index]));
  runs.sort((left, right) => (runOrder.get(left.runId) ?? -1) - (runOrder.get(right.runId) ?? -1));
  const scenarios = loaded.source.scenarios.map(source => {
    const history = runs.filter(run => run.scenarioId === source.id), valid = history.filter(run => run.state === 'ASSESSED'), latest = history.at(-1), chosen = valid.at(-1);
    const replacement = [...valid].reverse().find(run => run.explicitRerun), unresolvedIntegrity = history.filter(run => run.state === 'INTEGRITY_FAILURE' && (!replacement || history.indexOf(run) >= history.indexOf(replacement)));
    const status = unresolvedIntegrity.length ? null : valid.some(run => run.result.status === 'FAIL') ? 'FAIL' : latest?.state === 'ASSESSED' ? latest.result.status : latest?.state === 'INTERRUPTED' ? 'BLOCKED' : null;
    return {id: source.id, caseId: source.caseId, iteration: source.iteration, title: source.title, status, state: unresolvedIntegrity.length ? 'INTEGRITY_FAILURE' : latest?.state ?? 'NOT_RUN', selectedRunId: chosen?.runId ?? null,
      history: history.map(run => ({runId: run.runId, state: run.state, verdict: run.result?.status ?? null, supersededIntegrity: run.state === 'INTEGRITY_FAILURE' && !unresolvedIntegrity.includes(run)})),
      methods: chosen ? Object.fromEntries(['checked', 'observed', 'mixed', 'unresolved'].map(method => [method, aggregateSourceConditions(chosen.conditions).filter(expectation => expectation.method === method).length])) : {checked: 0, observed: 0, mixed: 0, unresolved: 0}};
  });
  const revisionFile = ownedFile(roots, executionId, 'delivery/revisions.json'), revisionCheck = existsSync(revisionFile) ? readBounded(revisionFile) : null;
  if (revisionCheck) requireThat(revisionCheck.version === 1 && revisionCheck.sourceFingerprint === loaded.execution.sourceFingerprint && typeof revisionCheck.checkedAt === 'string' && Number.isFinite(Date.parse(revisionCheck.checkedAt)) && Array.isArray(revisionCheck.revisions), 'Revision receipt differs from captured execution.');
  return {...loaded, runs, scenarios, revisionCheck, integrityFailures: scenarios.filter(scenario => scenario.state === 'INTEGRITY_FAILURE').map(scenario => scenario.id)};
}
export function executionDefects(view) {
  const groups = new Map();
  for (const row of view.runs.filter(run => run.state === 'ASSESSED')) {
    const source = view.source.scenarios.find(scenario => scenario.id === row.scenarioId), scenario = view.freeze.scenarios.find(item => item.id === source.id);
    for (const condition of row.conditions.filter(item => ['FAIL', 'INDETERMINATE'].includes(item.status))) {
      const expected = source.expectations.find(item => item.key === condition.key), item = {kind: 'expectation', caseId: source.caseId, sourceStep: expected.step, expectedIndex: expected.expected,
        conditionIndex: condition.index, conditionTemplate: expected.template, title: `${source.title}: ${condition.condition.text}`, status: condition.status,
        evidenceIds: condition.evidenceIds, runId: row.runId, scenarioId: source.id, stepId: condition.stepId, method: condition.method};
      const fp = defectFingerprint(view.source, item), group = groups.get(fp) ?? {fingerprint: fp, ...item, occurrences: []}; group.occurrences.push({runId: row.runId, scenarioId: source.id, status: item.status, evidenceIds: item.evidenceIds, legacy: condition.legacy, family: condition.family, method: condition.method}); groups.set(fp, group);
    }
    for (const diagnostic of row.diagnostics) for (const entry of diagnostic.entries.filter(entry => !entry.notice && (entry.detail || entry.path))) {
      const step = scenario.steps.find(step => step.id === diagnostic.stepId), values = row.result.scenarios[0].attempts.flatMap(attempt => [...attempt.inputs, ...attempt.outputs].filter(value => value.sensitivity === 'public').map(value => value.value));
      const signature = diagnosticSignature(entry.path ?? entry.detail, {bindings: source.bindings, values});
      const item = {kind: 'diagnostic', caseId: source.caseId, sourceStep: step?.sourceSteps[0] ?? 0, signature, title: `${source.title}: ${entry.kind} diagnostic`, status: 'DIAGNOSTIC', method: 'diagnostic', runId: row.runId, scenarioId: source.id, stepId: diagnostic.stepId, evidenceIds: [diagnostic.evidenceId]};
      const fp = defectFingerprint(view.source, item), group = groups.get(fp) ?? {fingerprint: fp, ...item, occurrences: []}; group.occurrences.push({runId: row.runId, scenarioId: source.id, status: item.status, evidenceIds: item.evidenceIds, legacy: diagnostic.legacy, family: diagnostic.family}); groups.set(fp, group);
    }
  }
  return [...groups.values()];
}
export function legacyCase(view, caseId) {
  return view.scenarios.filter(item => item.caseId === caseId).some(scenario => view.runs.some(run => run.scenarioId === scenario.id && run.state === 'ASSESSED'
    && (run.runId === scenario.selectedRunId || run.result.status === 'FAIL') && run.conditions.some(item => item.family === 'browser' && item.legacy)));
}
export function deliverableDefects(view, include = '') {
  const selected = new Set(include ? include.split(',') : []), skipped = [], defects = [];
  requireThat([...selected].every(item => ['needs-review', 'diagnostics'].includes(item)), 'Include supports needs-review,diagnostics.');
  for (const defect of executionDefects(view)) {
    const occurrences = defect.occurrences.filter(item => !item.legacy && (item.status === 'FAIL' && ['checked', 'observed', 'mixed'].includes(item.method ?? defect.method)
      || item.status === 'INDETERMINATE' && selected.has('needs-review') || item.status === 'DIAGNOSTIC' && selected.has('diagnostics')));
    if (occurrences.length) defects.push({...defect, status: occurrences.some(item => item.status === 'FAIL') ? 'FAIL' : defect.status, occurrences});
    else skipped.push({fingerprint: defect.fingerprint, reason: defect.occurrences.some(item => item.legacy) ? 'legacy-evidence' : 'not-selected'});
  }
  return {defects, skipped};
}
export function writeExecutionReport(roots, executionId, {keepLogin = false} = {}) {
  const view = collectExecution(roots, executionId), defects = executionDefects(view), path = `reports/harness/execute-${executionId}-${randomUUID()}`, output = reportDirectory(roots, path), artifacts = [];
  const write = (name, body) => {writeFileSync(join(output, name), body, {flag: 'wx', mode: 0o600, flush: true}); artifacts.push({path: name, sha256: digest(body), bytes: Buffer.byteLength(body)});};
  for (const row of view.runs.filter(run => run.state === 'ASSESSED')) {
    const receipt = writeReports(roots, row.result, {directory: `${path}/runs/${row.runId}`}); requireThat(receipt.status === 'WRITTEN', 'A per-run report could not be written.');
  }
  const summary = `# ${markdownText(view.source.title)}\n\nExecution: ${executionId}\n\n| Scenario | Outcome | Checked / observed / mixed |\n|---|---|---|\n${view.scenarios.map(row => `| ${markdownText(row.id)} | ${row.status ?? (row.state === 'INTEGRITY_FAILURE' ? 'INTEGRITY FAILURE (no verdict)' : row.state)} | ${row.methods.checked} / ${row.methods.observed} / ${row.methods.mixed} |`).join('\n')}\n\nExclusions: ${view.source.excluded.length}. Defect groups: ${defects.length}.\n`;
  write('summary.md', summary); write('defects.json', JSON.stringify(defects, null, 2) + '\n');
  write('defects.md', `# Defect list\n\n${defects.map(item => `- ${item.fingerprint}: ${item.status} — ${markdownText(item.title)} (${item.occurrences.length} occurrence(s))`).join('\n')}\n`);
  let imageBytes = 0;
  const h = escapeHtml, image = (row, record) => {
    if (record.bytes > 2 * 1024 * 1024 || imageBytes + record.bytes > 20 * 1024 * 1024) return '';
    const bytes = readFileSync(join(row.roots.runRoot, record.path)), png = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', jpeg = bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
    requireThat(bytes.length === record.bytes && digest(bytes) === record.sha256, 'Registered screenshot changed during report rendering.');
    if (!png && !jpeg) return ''; imageBytes += bytes.length; return `<img alt="Verified execution context" src="data:image/${png ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}">`;
  };
  const cards = view.scenarios.map(scenario => `<article><h2>${h(scenario.title)} · ${h(scenario.id)}</h2><strong>${h(scenario.status ?? (scenario.state === 'INTEGRITY_FAILURE' ? 'INTEGRITY FAILURE (no verdict)' : scenario.state))}</strong><p>Checked ${scenario.methods.checked}; observed ${scenario.methods.observed}; mixed ${scenario.methods.mixed}; unresolved ${scenario.methods.unresolved}.</p>${view.runs.filter(row => row.scenarioId === scenario.id).map(row => `<details><summary>${h(row.runId)} — ${h(row.result?.status ?? row.state)}</summary>${row.state === 'ASSESSED' ? `<a href="runs/${h(row.runId)}/index.html">Core report</a>${row.conditions.map(condition => `<details><summary>${h(condition.status)} (${h(condition.method)}): ${h(condition.condition.text)}</summary><pre>${h(JSON.stringify(condition.provenance ?? condition.condition, null, 2))}</pre></details>`).join('')}<h3>Cleanup</h3><pre>${h(JSON.stringify(row.result.scenarios[0].resources, null, 2))}</pre><h3>Diagnostics</h3><pre>${h(JSON.stringify(row.diagnostics, null, 2))}</pre>${['FAIL', 'NEEDS_REVIEW'].includes(row.result.status) ? row.result.evidence.filter(record => record.kind === 'screenshot').map(record => image(row, record)).join('') : ''}` : `<p>${h(row.reason ?? row.state)}</p>`}</details>`).join('')}</article>`).join('');
  const revisionSummary = view.revisionCheck ? '<section><h2>Source revisions</h2><p>Last checked before delivery: ' + h(view.revisionCheck.checkedAt) + '</p>' + view.source.cases.map(tc => {const changed = view.revisionCheck.revisions.find(change => change.caseId === tc.id); return '<p>Case ' + h(tc.id) + ': executed revision ' + h(tc.rev) + '; current revision ' + h(changed?.current ?? tc.rev) + (changed ? ' — SOURCE CHANGED</p><pre>' + h(JSON.stringify(changed)) + '</pre>' : ' — unchanged at last check</p>');}).join('') + '</section>' : '';
  write('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${h(view.source.title)}</title><style>body{font:16px/1.55 system-ui;max-width:1100px;margin:40px auto;padding:24px;color:#172d42;background:#f5f7fa}article{background:white;padding:24px;margin:20px 0;border:1px solid #ccd5df;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;padding:8px}img{max-width:100%;height:auto}strong{font-size:1.2em}</style></head><body><h1>${h(view.source.title)}</h1><p>${h(executionId)} · ${defects.length} defect group(s)</p><p><a href="summary.md">Summary</a> · <a href="defects.md">Defects</a></p>${revisionSummary}${cards}<h2>Source exclusions</h2><pre>${h(JSON.stringify(view.source.excluded, null, 2))}</pre></body></html>\n`);
  const manifest = {version: 1, status: 'WRITTEN', executionId, sourceFingerprint: view.execution.sourceFingerprint, freezeFingerprint: view.execution.freezeFingerprint, revisionCheck: view.revisionCheck, scenarios: view.scenarios, defects: defects.length, artifacts};
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});
  if (!keepLogin) deleteLogin(roots, executionId); return {status: 'WRITTEN', executionId, directory: path, scenarios: view.scenarios, defects: defects.length};
}
