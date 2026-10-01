#!/usr/bin/env node
// Fixed commands invoked by the actual native hosts in the opt-in M15 proof.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {consumerRoots} from '../../scripts/lib/consumer-paths.mjs';
import {loadLocalSource} from '../../scripts/lib/local-source.mjs';
import {loadEnvironment} from '../../scripts/lib/project-config.mjs';
import {fingerprint, digest} from '../../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from '../../scripts/lib/generation/index.mjs';
import {transaction} from '../../scripts/lib/generation/storage.mjs';
import {verifyGeneration} from '../../scripts/lib/generation/verify.mjs';
import {generateAllure} from '../../scripts/lib/reporting/allure.mjs';
import {workflowRefinement, workflowNotes, workflowSemantics} from '../../scripts/lib/workflow-parity.mjs';
import {workflowCases, exploreWorkflow, workflowExecutionIds, generatedExecutionIds} from './workflow.mjs';

const roots = consumerRoots(), fixture = workflowCases(), stage = process.argv[2], directory = join(roots.projectRoot, '.harness/workflow');
const read = path => JSON.parse(readFileSync(join(roots.projectRoot, path), 'utf8'));
const save = (path, value) => {const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}); return file;};
const receipt = (path, stage) => console.log(JSON.stringify({receipt: 'M15_WORKFLOW_RECEIPT', stage, sha256: digest(readFileSync(path)), scenarios: fixture.cases.length}));
try {
  assert(['claude', 'codex'].includes(process.env.HARNESS_WORKFLOW_HOST), 'Use the owned M15 host fixture.');
  assert.deepEqual(read('source.json'), fixture.source, 'Original source is immutable.');
  if (stage === 'explore') {
    assert(!existsSync(join(directory, 'exploration.json')), 'Do not overwrite or repeat exploration.');
    workflowRefinement(fixture.source, read('refinement.json'));
    save('.harness/workflow/refinement-receipt.json', {version: 1, phase: 'BEFORE_EXPLORATION', sourceFingerprint: fingerprint(fixture.source), sha256: digest(readFileSync(join(roots.projectRoot, 'refinement.json')))});
    const loaded = loadLocalSource(roots, 'source.json'); save('.harness/workflow/source-provenance.json', loaded.source);
    const explored = await exploreWorkflow(roots, process.env.HARNESS_PROOF_ORIGIN, loadEnvironment(roots).targets.databases);
    const handoff = createGenerationHandoff(fixture.source, explored.generationExecutions, explored.bindings);
    await beginGeneration(roots, handoff, `m15-${process.env.HARNESS_WORKFLOW_HOST}`);
    const file = save('.harness/workflow/exploration.json', explored.executions);
    // Bounded, sanitized current-run references for the host's refinement and knowledge candidates.
    const facts = handoff.expectations.map(e => {
      const binding = handoff.bindings.find(b => b.key === e.key), observation = handoff.observations.find(o => o.runId === binding.runId);
      const assertions = observation.scenarios.find(s => s.id === binding.scenarioId).attempts.flatMap(a => a.assertions).filter(a => a.id === binding.expectationId && a.reliable);
      return {key: e.key, scenarioId: e.scenarioId, runId: binding.runId, evidenceIds: [...new Set(assertions.flatMap(a => a.evidenceIds))].sort(), assertionStatuses: assertions.map(a => a.status)};
    });
    save('.harness/workflow/context.json', {version: 1, sourceFingerprint: fingerprint(fixture.source), facts, scenarios: fixture.cases.map(c => ({id: c.id, expectationKeys: [c.key]}))});
    receipt(file, stage);
  } else if (stage === 'candidate') {
    const state = await transaction(roots, fixture.source.id, state => state);
    assert.equal(read('.harness/workflow/refinement-receipt.json').sha256, digest(readFileSync(join(roots.projectRoot, 'refinement.json'))), 'Do not rewrite the scope refined before exploration.');
    workflowNotes(fixture.source, state.handoff, read('refinement.json'), read('.harness/knowledge-candidates/workflow.json'));
    const checks = [];
    for (const [name, args] of [['conventions', [join(roots.packageRoot, 'scripts/check-conventions.mjs'), '--root', roots.projectRoot, '--fail-on-warn']],
      ['types', [join(roots.packageRoot, 'examples/node_modules/typescript/bin/tsc'), '--project', join(roots.projectRoot, 'tsconfig.json'), '--noEmit']]]) {
      const output = execFileSync(process.execPath, args, {cwd: roots.projectRoot, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024});
      checks.push({name, exitCode: 0, output});
    }
    const candidate = await registerCandidate(roots, fixture.source.id, {config: 'playwright.config.ts', tests: fixture.cases.map(c => ({scenarioId: c.id, spec: 'tests/ObservationTests.spec.ts', project: 'proof', titlePath: ['Workflow observations', c.title]})),
      ...(state.candidates.length ? {repair: 'review-findings'} : {})});
    const file = save(`.harness/workflow/candidates/${candidate.revision}.json`, {revision: candidate.revision, fingerprint: candidate.snapshot.fingerprint, sourceId: fixture.source.id, round: candidate.round, checks,
      notes: {refinement: digest(readFileSync(join(roots.projectRoot, 'refinement.json'))), knowledge: digest(readFileSync(join(roots.projectRoot, '.harness/knowledge-candidates/workflow.json')))}});
    receipt(file, stage);
  } else if (stage === 'complete') {
    const state = await transaction(roots, fixture.source.id, state => state), candidate = state.candidates.at(-1);
    assert(candidate, 'A candidate must exist.');
    await recordGenerationReview(roots, fixture.source.id, read(`.harness/workflow/reviews/${candidate.revision}.json`));
    const status = await generationStatus(roots, fixture.source.id);
    if (status.status === 'NEEDS_REVIEW') {
      receipt(save(`.harness/workflow/rejected/${candidate.revision}.json`, status), 'review-rejected');
    } else {
      const first = await verifyGeneration(roots, fixture.source.id, {allure: true, timeoutMs: 300000}); assert.equal(first.status, 'PASS', 'First scoped verification failed; do not retry to green.');
      const second = await verifyGeneration(roots, fixture.source.id, {allure: true, timeoutMs: 300000}); assert.equal(second.status, 'PASS', 'Second scoped verification failed; do not retry to green.');
      for (const verification of [first, second]) assert.equal((await generateAllure(roots, verification.reporting.directory)).status, 'GENERATED');
      const semantic = await workflowSemantics(roots, {source: fixture.source, executionIds: workflowExecutionIds, generatedIds: generatedExecutionIds});
      const result = await generationStatus(roots, fixture.source.id);
      receipt(save('.harness/workflow/completed.json', {status: result.status, greens: result.greens, scenarios: fixture.cases.length, semanticFingerprint: fingerprint(semantic)}), stage);
    }
  } else throw new Error('Use explore, candidate or complete.');
} catch (error) {
  mkdirSync(directory, {recursive: true});
  // Native diagnostics are retained only in this private, synthetic consumer.
  writeFileSync(join(directory, `failure-${stage}-${Date.now()}.txt`), [String(error.stack), error.stdout, error.stderr].filter(value => value !== undefined).join('\n'), {flag: 'wx', mode: 0o600});
  console.error(JSON.stringify({proof: 'M15', stage, status: 'INCOMPLETE'})); process.exitCode = 1;
}
