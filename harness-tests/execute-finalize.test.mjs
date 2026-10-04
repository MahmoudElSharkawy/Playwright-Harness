import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {executionFixture} from './fixtures/execute.mjs';
import {fakeNative} from './fixtures/fake-native.mjs';
import {readFrozen, writeJson, ownedFile, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {writeFileSync} from 'node:fs';
import {collectExecution} from '../scripts/lib/execute/report.mjs';
import {runInput} from '../scripts/lib/execute/host.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {runSequentialScenario} from '../scripts/lib/sequential/index.mjs';
import {BrowserCommands} from '../scripts/lib/execute/commands.mjs';

async function fixture(t, {capability = 'reads', ...nativeOptions} = {}) {
  const f = await executionFixture(t, {browser: true, steps: [{action: 'Inspect Save', expected: 'Save is disabled'}]});
  const step = f.refinement.scenarios[0].steps[0]; step.capability = 'reads'; step.readOnlyContract = {reason: 'Synthetic read only.'};
  if (capability === 'mutations') {step.capability = capability; delete step.readOnlyContract;}
  step.expectations[0].conditions = [{text: step.expectations[0].conditions[0].text, predicate: 'state:disabled', subject: {element: {role: 'button', name: 'Save'}}, expected: null, precondition: false, exact: false, ambiguous: false}];
  f.save(); f.freeze();
  const loaded = readFrozen(f.roots, f.executionId), scenario = loaded.freeze.scenarios[0], source = loaded.source.scenarios[0];
  const run = createRun(runInput(loaded.freeze, source, scenario, `run-${randomUUID()}`)), roots = {...f.roots, runRoot: join(f.projectRoot, '.harness/runs', f.executionId, run.id)}, native = fakeNative(nativeOptions);
  const execute = async (action, options = {}) => {
    let assertionError;
    const result = await runSequentialScenario(run, roots, {browser: {target: 'ui', nativeSession: native.factory}, ...options}, {exercise: async phase => {
    const frozen = scenario.steps[0];
    await phase.browser.attempt({operation: frozen.operation, invocationId: frozen.id, retry: frozen.capability === 'reads'}, async context => {
      const commands = new BrowserCommands({context, step: frozen, sourceScenario: source, references: loaded.freeze.referenceValues, outputs: new Map(), roots, executionId: f.executionId, runId: run.id, diagnostics: 'off'});
      try {await action(commands, context, frozen.contracts[0].key);} catch (error) {if (error instanceof assert.AssertionError) assertionError ??= error; throw error;}
    });
    }});
    if (assertionError) throw assertionError; return result;
  };
  const persist = () => {
    const input = runInput(loaded.freeze, source, scenario, run.id, run.startedAt);
    writeJson(ownedFile(f.roots, f.executionId, `snapshots/${run.id}.json`), {version: 1, executionId: f.executionId, scenarioId: scenario.id, runId: run.id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input, explicitRerun: false}, {exclusive: true});
    saveExecution(f.roots, f.executionId, {...loaded.execution, runs: [{runId: run.id, scenarioId: scenario.id, startedAt: run.startedAt, explicitRerun: false, state: 'FINISHED'}]});
  };
  return {...f, native, execute, persist, run, runRoots: roots};
}

test('E3: injected native session runs real sequential browser assessment offline', async t => {
  const f = await fixture(t);
  const result = await f.execute(async (commands, context, key) => {await commands.check(key, 1, {read: 'state e1'}); await commands.finalize('none');});
  assert.equal(result.status, 'PASS'); assert(f.native.calls.some(args => args[0] === 'eval'));
});

test('F1 F4 V1: failed mutation reconciles against a fresh snapshot and settles atomically', async t => {
  let fail = true;
  const f = await fixture(t, {capability: 'mutations', command: args => {
    if (args[0] === 'click' && fail) {fail = false; return {stdout: JSON.stringify({error: 'Target changed'}), exitCode: 1, dispatched: true};}
  }});
  const result = await f.execute(async (commands, context, key) => {
    const old = await commands.snapshot();
    await assert.rejects(commands.native(['click', 'e1'])); assert.equal(commands.ledger.stateVersion, 1);
    await assert.rejects(commands.dispatch(['reconcile', 'effect', '--evidence', old.id]), /fresh/);
    const fresh = await commands.snapshot(), args = ['reconcile', 'effect', '--evidence', fresh.id];
    await commands.dispatch(args); const artifacts = commands.artifacts.size;
    await commands.dispatch(args); assert.equal(commands.artifacts.size, artifacts);
    await assert.rejects(commands.dispatch(['reconcile', 'no-effect', '--evidence', fresh.id]), /immutable/);
    await assert.rejects(commands.native(['click', 'e1']), /observations and settlement/);
    await commands.check(key, 1, {read: 'state e1'}); await commands.finalize('confirmed');
  });
  assert.equal(result.status, 'PASS');
  const attempt = result.scenarios[0].attempts.find(item => item.identity.phase === 'EXERCISE');
  assert.equal(attempt.effect.certainty, 'uncertain'); assert.equal(attempt.reconciliation.kind, 'confirmed-effect');
  assert.equal(result.evidence.filter(item => item.kind === 'reconciliation').length, 1);
});

test('F5: invalid not-executed settlement leaves evaluated FAIL available for a valid commit', async t => {
  const f = await fixture(t, {evaluate: () => ({disabled: false, enabled: true})}); let settled = false;
  const result = await f.execute(async (commands, context, key) => {
    await commands.check(key, 1, {read: 'state e1'});
    await assert.rejects(commands.finalize('not-executed'), /evaluated assertions/);
    await commands.finalize('none'); settled = true;
  });
  assert(settled); assert.equal(result.status, 'FAIL');
});

test('F5: a genuinely unexecuted step settles without dispatching a business action', async t => {
  const f = await fixture(t, {capability: 'mutations'});
  const result = await f.execute(async commands => {await commands.finalize('not-executed');});
  const attempt = result.scenarios[0].attempts.find(item => item.identity.phase === 'EXERCISE');
  assert.equal(attempt.effect.certainty, 'not-executed');
  assert.equal(attempt.outputs.length, 0); assert(attempt.assertions.every(item => !['PASS', 'FAIL'].includes(item.status)));
  assert.notEqual(result.status, 'PASS'); assert(!f.native.calls.some(args => ['click', 'fill', 'type'].includes(args[0])));
});

for (const fact of ['action', 'capture']) test(`F5: ${fact} prevents not-executed settlement and keeps a valid settlement available`, async t => {
  const f = await fixture(t, {capability: 'mutations'}); let settled = false;
  const result = await f.execute(async commands => {
    if (fact === 'action') {await commands.snapshot(); await commands.native(['click', 'e1']);}
    else await commands.dispatch(['capture', 'captured', '--read', 'value e1']);
    await assert.rejects(commands.finalize('not-executed'), /dispatched actions, outputs or evaluated assertions/);
    await commands.finalize(fact === 'action' ? 'confirmed' : 'none'); settled = true;
  });
  assert(settled); const attempt = result.scenarios[0].attempts.find(item => item.identity.phase === 'EXERCISE');
  assert.equal(attempt.effect.certainty, fact === 'action' ? 'confirmed' : 'none');
  assert.equal(attempt.outputs.length, fact === 'capture' ? 1 : 0);
  if (fact === 'capture') assert.equal(attempt.outputs[0].producer.attemptId, attempt.identity.attemptId);
  assert.notEqual(result.status, 'PASS');
});

for (const command of ['screenshot', 'state-save']) test(`F6: ${command} failure poisons a real attempt`, async t => {
  const f = await fixture(t, {command: args => args[0] === command ? {stdout: JSON.stringify({error: 'Synthetic capture failure'}), exitCode: 1, dispatched: true} : undefined}); let settled = false;
  const result = await f.execute(async (commands, context, key) => {
    await commands.check(key, 1, {read: 'state e1'});
    if (command === 'screenshot') await assert.rejects(commands.screenshot());
    else {commands.step = {...commands.step, login: {user: 'tester', landmark: 'Save'}}; await assert.rejects(commands.dispatch(['save-login']));}
    assert(commands.ledger.poisoned); await commands.finalize('none'); settled = true;
  });
  assert(settled); assert.notEqual(result.status, 'PASS');
});

for (const boundary of ['dispatch', 'polling', 'finalization']) test(`H4: expiry during ${boundary} settles recorded FAIL exactly once`, async t => {
  const controller = new AbortController(); let pending = false, commitCount = 0;
  const f = await fixture(t, {evaluate: () => ({disabled: false, enabled: true}), command: async (args, options) => {
    if (pending && args[0] === 'snapshot') {controller.abort(); await new Promise(resolve => {if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, {once: true});}); return {kind: 'CANCELLED', dispatched: true};}
  }});
  const result = await f.execute(async (commands, context, key) => {
    await commands.check(key, 1, {read: 'state e1'});
    const original = commands.settle.bind(commands); commands.settle = async effect => {commitCount++; return original(effect);};
    if (boundary === 'finalization') {
      const evidence = context.evidence;
      context.evidence = (kind, value) => {const pending = evidence(kind, value); if (kind === 'assertion') controller.abort(); return pending;};
      await commands.finalize('none'); return;
    }
    pending = true;
    if (boundary === 'polling') await commands.check(key, 1, {read: 'state e1', wait: '1000'});
    else await commands.snapshot();
  }, {signal: controller.signal, cleanupReserveMs: 1000});
  assert.equal(result.status, 'FAIL'); assert.equal(commitCount, 1);
});

for (const interruption of ['stop', 'command-limit', 'size-limit', 'expiry']) test(`F2 H4: ${interruption} during real cleanup retains resource obligations and earlier FAIL`, async t => {
  const f = await executionFixture(t, {browser: true, steps: [{action: 'Create item', expected: 'Save is disabled'}, {action: 'Delete item', expected: 'Save is disabled'}]});
  for (const step of f.refinement.scenarios[0].steps) step.expectations[0].conditions = [{text: step.expectations[0].conditions[0].text, predicate: 'state:disabled', subject: {element: {role: 'button', name: 'Save'}}, expected: null, precondition: false, exact: false, ambiguous: false}];
  const [create, cleanup] = f.refinement.scenarios[0].steps; create.creates = [{resource: 'record', identityOutput: 'recordId', intent: 'temporary', cleanupStep: cleanup.id}];
  cleanup.phase = 'CLEANUP'; cleanup.cleanupResource = 'record'; cleanup.inputs = [{name: 'recordId', source: 'output:recordId'}];
  f.refinement.limits.cleanupTimeoutMs = 1400; f.freeze();
  const loaded = readFrozen(f.roots, f.executionId), scenario = loaded.freeze.scenarios[0], source = loaded.source.scenarios[0], run = createRun(runInput(loaded.freeze, source, scenario, `run-${randomUUID()}`));
  const roots = {...f.roots, runRoot: ownedFile(f.roots, f.executionId, run.id)}, native = fakeNative({snapshot: '- button "Save" [ref=e1]\n- textbox "Identity" [ref=e2]', evaluate: args => args[1].includes('harness-read:value') ? 'record-1' : {disabled: false, enabled: true}}); let produced;
  const commandsFor = (context, step) => new BrowserCommands({context, step, sourceScenario: source, references: {}, outputs: new Map(), roots, executionId: f.executionId, runId: run.id, diagnostics: 'off'});
  const result = await runSequentialScenario(run, roots, {cleanupReserveMs: 1000, browser: {target: 'ui', nativeSession: native.factory}}, {
    exercise: async phase => {const step = scenario.steps[0]; const attempt = await phase.browser.attempt({operation: step.operation, invocationId: step.id}, async context => {
      const commands = commandsFor(context, step); await commands.snapshot(); await commands.native(['click', 'e1']); await commands.dispatch(['capture', 'recordId', '--read', 'value e2']);
      await commands.check(step.contracts[0].key, 1, {read: 'state e1'}); await commands.finalize('confirmed');
    }); produced = attempt.outputs[0];},
    cleanup: async phase => {const step = scenario.steps[1]; assert(phase.resource('record')); await phase.browser.attempt({operation: step.operation, invocationId: step.id, inputs: [produced]}, async context => {
      const commands = commandsFor(context, step); await commands.snapshot(); await commands.native(['click', 'e1']);
      if (interruption === 'expiry') await new Promise(() => {});
      else {if (interruption === 'size-limit') commands.ledger.finishRequired = true; await commands.finalize('uncertain', {interrupted: true});}
    });}
  });
  assert.equal(result.status, 'FAIL'); const resource = result.scenarios[0].resources.find(item => item.id === 'record');
  assert.equal(resource.lifecycle.status, 'failed'); assert(resource.lifecycle.evidenceIds.length > 0);
  assert.equal(result.scenarios[0].attempts.filter(item => item.identity.invocationId === cleanup.id).length, 1);
});

test('F6: required screenshot failure cannot be reconciled into a clean PASS', async t => {
  const f = await fixture(t, {capability: 'mutations', command: args => args[0] === 'screenshot' ? {stdout: JSON.stringify({error: 'Failed required screenshot'}), exitCode: 1, dispatched: true} : undefined});
  const result = await f.execute(async (commands, context, key) => {
    await commands.snapshot(); await commands.native(['click', 'e1']); await commands.check(key, 1, {read: 'state e1'});
    await assert.rejects(commands.screenshot()); const fresh = await commands.snapshot();
    await assert.rejects(commands.dispatch(['reconcile', 'effect', '--evidence', fresh.id]), /uncertain dispatched mutation/);
    await commands.finalize('confirmed');
  });
  assert.notEqual(result.status, 'PASS');
});

test('F4: an incorrect accepted no-effect reconciliation can be ruled indeterminate without retry', async t => {
  const f = await fixture(t, {capability: 'mutations', command: args => args[0] === 'click' ? {stdout: JSON.stringify({error: 'Lost response'}), exitCode: 1, dispatched: true} : undefined});
  const result = await f.execute(async (commands, context, key) => {
    await commands.snapshot(); await assert.rejects(commands.native(['click', 'e1'])); const fresh = await commands.snapshot();
    await commands.dispatch(['reconcile', 'no-effect', '--evidence', fresh.id]);
    await commands.dispatch(['indeterminate', key, '--reason', 'insufficient-evidence']); assert.equal(commands.manualRetry, false);
    await commands.finalize('none');
  });
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.native.calls.filter(args => args[0] === 'click').length, 1);
});

test('H4: settlement exposes no native work and rejects evidence and commits after expiry', async t => {
  const controller = new AbortController(), f = await fixture(t, {evaluate: () => ({disabled: false, enabled: true})}); let commands;
  const result = await f.execute(async (current, context, key) => {commands = current; await commands.check(key, 1, {read: 'state e1'}); controller.abort(); await new Promise(() => {});}, {signal: controller.signal, cleanupReserveMs: 1000});
  assert.equal(result.status, 'FAIL'); const count = result.evidence.length;
  assert.equal(commands.settlementContext.native, undefined);
  await assert.rejects(commands.settlementContext.evidence('observation', {late: true}), /ended/);
  assert.throws(() => commands.settlementContext.commit({}), /ended/); assert.equal(result.evidence.length, count);
});

test('F7 S7: authorized read retry publishes only each attempt own capture producer', async t => {
  let first = true;
  const f = await fixture(t, {evaluate: args => args[1].includes('harness-read:value') ? first ? 'first' : 'replacement' : {disabled: true, enabled: false}, command: args => {
    if (args[0] === 'tab-list' && first) {first = false; return {stdout: JSON.stringify({error: 'Transient read failure'}), exitCode: 1, dispatched: true};}
  }});
  const result = await f.execute(async (commands, context, key) => {
    await commands.dispatch(['capture', 'captured', '--read', 'value e1']);
    if (first) {await assert.rejects(commands.native(['tab-list'])); await commands.finalize('none');}
    else {await commands.check(key, 1, {read: 'state e1'}); await commands.finalize('none');}
  });
  assert.equal(result.status, 'PASS'); const attempts = result.scenarios[0].attempts.filter(item => item.identity.phase === 'EXERCISE');
  assert.equal(attempts.length, 2); assert.equal(attempts[1].outputs[0].value, 'replacement');
  assert(attempts.every(attempt => attempt.outputs.every(output => output.producer.attemptId === attempt.identity.attemptId)));
  assert.notEqual(attempts[0].outputs[0].producer.attemptId, attempts[1].outputs[0].producer.attemptId);
});

test('V6 D3: persisted browser v2 provenance reassesses stale comparisons and rejects changed read bytes', async t => {
  const f = await fixture(t);
  await f.execute(async (commands, context, key) => {await commands.check(key, 1, {read: 'state e1'}); await commands.native(['hover', 'e1']); await commands.check(key, 1, {read: 'state e1'}); await commands.finalize('none');}); f.persist();
  let view = collectExecution(f.roots, f.executionId); assert.equal(view.runs[0].state, 'ASSESSED'); assert.equal(view.scenarios[0].status, 'PASS');
  assert.equal(view.runs[0].conditions[0].provenance.schema, 'execute-assertion/2');
  const readId = view.runs[0].conditions[0].provenance.results[0].read.artifactId, record = view.runs[0].result.evidence.find(item => item.id === readId);
  writeFileSync(join(f.runRoots.runRoot, record.path), '{"altered":true}'); view = collectExecution(f.roots, f.executionId); assert.equal(view.runs[0].state, 'INTEGRITY_FAILURE');
});
