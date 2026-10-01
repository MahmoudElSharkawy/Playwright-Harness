// Fixed native regression fixtures for browser failure accounting; not a consumer execution API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join, basename} from 'node:path';
import {createRun, defineOperation} from '../../scripts/lib/execution-core/index.mjs';
import {runBrowserScenario, browserLifecycleOperations} from '../../scripts/lib/browser/index.mjs';
import {treeGone} from '../../scripts/lib/browser/processes.mjs';

const phases = ['SETUP', 'EXERCISE', 'VERIFY', 'CLEANUP', 'RESTORE'];
export const unreachedCases = Object.freeze([
  ...phases.map(phase => ({name: `unreached-${phase.toLowerCase()}`, phase})),
  {name: 'unreached-open-failure', mode: 'open'}, {name: 'unreached-legacy-phase', mode: 'legacy'},
  {name: 'unreached-before-phase-advance', mode: 'advance', phase: 'SETUP'},
  {name: 'unreached-placeholder-write-failure', mode: 'write'},
  {name: 'started-attempt-validation-failure', mode: 'validation'},
  {name: 'unreached-preserves-reliable-failure', mode: 'assertion', phase: 'VERIFY'},
  {name: 'unreached-normal-return', mode: 'normal'}
].map(Object.freeze));

export async function proveUnreachedCase(input, {packageRoot, projectRoot, origin}) {
  const roots = {packageRoot, projectRoot, runRoot: join(projectRoot, '.harness/runs', input.name)};
  const environment = {name: 'qa', environmentMode: 'test', apiTargets: [], databaseTargets: [], browserTargets: ['app'],
    targets: {api: {}, databases: {}, browser: {app: {origins: [origin]}}}};
  const operation = defineOperation({id: 'pending', family: 'browser', target: 'app', capability: input.mode === 'validation' ? 'browserMutations' : 'browserReads',
    source: {kind: 'inline', reference: 'synthetic-unreached-regression', version: '1'}, definition: {intent: 'Observe the owned synthetic browser'}});
  const executed = defineOperation({id: 'executed', family: 'browser', target: 'app', capability: 'browserReads', source: operation.source,
    definition: {intent: 'Observe before the synthetic interruption'}});
  const pendingPhases = input.mode === 'open' ? phases : [input.phase ?? (input.mode === 'legacy' ? undefined : 'EXERCISE')];
  const expectations = pendingPhases.flatMap((phase, index) => ['one', 'two'].map(suffix => ({id: `pending-${index}-${suffix}`, description: 'Unreached synthetic observation',
    operationId: operation.id, invocationId: `pending-${index}`, ...(phase === undefined ? {} : {phase}), requiredEvidence: ['observation']})));
  if (['advance', 'assertion'].includes(input.mode)) expectations.unshift({id: 'executed', description: 'Actual native observation', operationId: executed.id,
    invocationId: 'executed', phase: 'EXERCISE', requiredEvidence: ['observation']});
  const run = createRun({id: input.name, environment, operations: [operation, executed, ...browserLifecycleOperations('app')], scenarios: [{id: input.name, expectations}],
    limits: {timeoutMs: 120000, cleanupTimeoutMs: 60000}});
  let storageState, trees = [], injected = false, bodyEntered = false, result, failure;
  if (input.mode === 'open') {storageState = join(projectRoot, `${input.name}-invalid-state.json`); await fs.writeFile(storageState, '{', {mode: 0o600, flag: 'wx'});}
  const originalWrite = fs.writeFile;
  fs.writeFile = async (...args) => {
    if (basename(String(args[0])) === 'native-ownership.next.json') {
      const receipt = JSON.parse(String(args[1])); if (receipt.trees.length) trees = receipt.trees;
    }
    if (input.mode === 'write' && !injected && Buffer.isBuffer(args[1]) && args[1].toString().startsWith('{"invoked":false')) {
      injected = true; throw new Error('Synthetic placeholder evidence failure.');
    }
    return originalWrite(...args);
  };
  syncBuiltinESMExports();
  try {
    result = await runBrowserScenario(run, roots, {target: 'app', ...(storageState ? {storageState} : {}), nativeTimeoutMs: 2500, commandTimeoutMs: 15000}, async browser => {
      bodyEntered = true;
      if (input.mode === 'normal') return;
      if (['advance', 'assertion'].includes(input.mode)) {
        await browser.attempt({operation: executed, invocationId: 'executed', phase: 'EXERCISE'}, async context => {
          await context.native(['eval', 'document.title']);
          const proof = await context.evidence('observation', {observed: true});
          context.assertion({id: 'executed', status: input.mode === 'assertion' ? 'FAIL' : 'PASS', reliable: true, evidenceIds: [proof]});
        });
        if (input.mode === 'advance') return;
      }
      if (input.mode === 'validation') {
        await browser.attempt({operation, invocationId: 'pending-0'}, async context => {
          await context.native(['eval', 'document.title']);
          const proof = await context.evidence('observation', {observed: true});
          context.effect({certainty: 'uncertain', resourceIds: []});
          context.assertion({id: 'pending-0-one', status: 'INVALID', reliable: false, evidenceIds: [proof]});
        });
      }
      throw new Error('Synthetic body interruption before remaining expectations.');
    });
  } catch (error) {failure = error;}
  finally {fs.writeFile = originalWrite; syncBuiltinESMExports();}

  // Prove physical cleanup separately from whichever result/error the scenario returned.
  assert.ok(trees.length, 'The regression must acquire an actual native browser.');
  assert.ok((await Promise.all(trees.map(tree => treeGone(tree)))).every(Boolean), 'Owned native processes survived.');
  await assert.rejects(fs.stat(join(roots.runRoot, 'protected')), {code: 'ENOENT'});
  assert.equal(bodyEntered, input.mode !== 'open');
  if (['write', 'validation'].includes(input.mode)) {
    assert.ok(failure instanceof Error); assert.equal(result, undefined);
    if (input.mode === 'write') {
      assert.equal(injected, true); assert.match(failure.message, /Synthetic placeholder evidence failure/);
      await assert.rejects(fs.stat(join(roots.runRoot, 'result.json')), {code: 'ENOENT'});
    } else {
      const observations = JSON.parse(await fs.readFile(join(roots.runRoot, 'observations.json'), 'utf8'));
      assert.equal(observations.scenarios[0].attempts.some(attempt => attempt.identity.invocationId === 'pending-0'), false,
        'An incomplete started invocation must not become a fabricated not-executed placeholder.');
    }
    return {result: 'INCOMPLETE', integrityError: true, processesStopped: true, protectedStorageRemoved: true};
  }
  assert.ifError(failure); assert.notEqual(result.status, 'PASS');
  assert.equal(result.scenarios[0].requiredLifecycleComplete, true);
  assert.equal(result.status, input.mode === 'assertion' ? 'FAIL' : ['open', 'advance', 'normal'].includes(input.mode) ? 'BLOCKED' : 'NEEDS_REVIEW');
  for (const [index, phase] of pendingPhases.entries()) {
    const attempts = result.scenarios[0].attempts.filter(attempt => attempt.identity.invocationId === `pending-${index}`);
    assert.equal(attempts.length, 1); assert.equal(attempts[0].identity.phase, phase ?? 'EXERCISE');
    assert.equal(attempts[0].assertions.length, 2); assert.ok(attempts[0].assertions.every(assertion => assertion.status === 'NOT_EVALUATED'));
    assert.equal(attempts[0].effect.certainty, 'not-executed');
  }
  return {verdict: result.status, attempts: result.scenarios[0].attempts.length, unevaluated: result.scenarios[0].counts.notEvaluated,
    processesStopped: true, protectedStorageRemoved: true};
}
