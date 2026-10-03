import {existsSync, openSync, closeSync, mkdirSync, rmSync, copyFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRun} from '../execution-core/index.mjs';
import {data, fingerprint, requireThat, id} from '../execution-core/data.mjs';
import {runSequentialScenario} from '../sequential/index.mjs';
import {consumerEnvironment} from '../consumer-env.mjs';
import {protect} from '../generation/storage.mjs';
import {readFrozen, readBounded, ownedFile, writeJson, saveExecution} from './storage.mjs';
import {scopedReadiness} from './refinement.mjs';
import {acquireLauncher, recordSpawned, processIdentity, claimHost, releaseHost, lockStatus} from './lock.mjs';
import {HostMailbox, controlDirectory, delay} from './mailbox.mjs';
import {BrowserCommands, parseOptions, redact} from './commands.mjs';

const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); promise.catch(() => {}); return {promise, resolve, reject};};
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const terminal = new Set(['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE']);

/** Freeze typed initial bindings without persisting protected values. */
export function runInput(freeze, sourceScenario, scenario, runId, startedAt = Date.now()) {
  const values = new Map(), sources = new Map();
  for (const step of scenario.steps) for (const binding of step.inputs ?? []) {
    const colon = binding.source.indexOf(':'), kind = binding.source.slice(0, colon), name = binding.source.slice(colon + 1);
    if (kind === 'output') continue;
    requireThat(!sources.has(binding.name) || sources.get(binding.name) === binding.source, 'Initial input name has conflicting sources.'); sources.set(binding.name, binding.source);
    let value;
    if (kind === 'parameter') {requireThat(Object.hasOwn(sourceScenario.bindings, name) && !sourceScenario.needsBinding.includes(name), 'Parameter needs a protected environment binding.'); value = sourceScenario.bindings[name];}
    else if (kind === 'reference') {requireThat(freeze.referenceValues[name] && !freeze.referenceValues[name].assumed, 'Input reference is unavailable or assumed.'); value = freeze.referenceValues[name].value;}
    const producer = {runId, scenarioId: scenario.id, name: binding.name};
    values.set(binding.name, kind === 'env' ? {name: binding.name, type: 'string', sensitivity: 'sensitive', protectedRef: `protected:${name}`, producer}
      : {name: binding.name, type: typeOf(value), sensitivity: 'public', value, producer});
  }
  return data({id: runId, startedAt, environment: freeze.environment, operations: scenario.operations, scenarios: [{id: scenario.id, expectations: scenario.expectations}], values: [...values.values()], limits: scenario.limits});
}
export function restoreRun(snapshot, loaded) {
  requireThat(snapshot.version === 1 && snapshot.executionId === loaded.execution.id && snapshot.freezeFingerprint === loaded.execution.freezeFingerprint, 'Run snapshot differs from frozen execution.');
  const scenario = loaded.freeze.scenarios.find(item => item.id === snapshot.scenarioId), source = loaded.source.scenarios.find(item => item.id === snapshot.scenarioId);
  requireThat(scenario && source && snapshot.input.id === snapshot.runId, 'Run snapshot has an unknown scenario.');
  const expected = runInput(loaded.freeze, source, scenario, snapshot.runId, snapshot.input.startedAt);
  requireThat(fingerprint(expected) === fingerprint(snapshot.input), 'Run snapshot inputs changed.');
  const run = createRun(snapshot.input); requireThat(run.inputFingerprint === snapshot.inputFingerprint, 'Run input fingerprint changed.'); return run;
}
function updateRun(roots, executionId, runId, patch) {
  const loaded = readFrozen(roots, executionId), execution = loaded.execution;
  execution.runs = execution.runs.map(item => item.runId === runId ? {...item, ...patch} : item); saveExecution(roots, executionId, execution);
}
export function deleteLogin(roots, executionId) {
  const path = ownedFile(roots, executionId, 'auth'); if (existsSync(path)) rmSync(path, {recursive: true});
}
export function importLogin(roots, executionId, target, user, file) {
  id(target); id(user); const loaded = readFrozen(roots, executionId);
  requireThat(loaded.freeze.environment.targets.browser?.[target]?.users?.[user], 'Login user is not configured.');
  const state = readBounded(file); requireThat(Array.isArray(state.cookies) && Array.isArray(state.origins), 'Invalid browser storage state.');
  const directory = ownedFile(roots, executionId, 'auth'); mkdirSync(directory, {recursive: true, mode: 0o700}); protect(directory);
  copyFileSync(file, join(directory, `${target}-${user}.json`)); chmodSync(join(directory, `${target}-${user}.json`), 0o600);
  return {status: 'LOGIN_IMPORTED', executionId, target, user};
}

/** One process and one sequential-runtime call per frozen scenario. */
export async function runHostedScenario(roots, executionId, runId, nonce, {runtime = runSequentialScenario, mailboxFactory = (...args) => new HostMailbox(...args), idleMs = 30 * 60 * 1000} = {}) {
  await claimHost(roots, nonce);
  const loaded = readFrozen(roots, executionId), snapshot = readBounded(ownedFile(roots, executionId, `snapshots/${runId}.json`)), run = restoreRun(snapshot, loaded);
  const scenario = loaded.freeze.scenarios.find(item => item.id === snapshot.scenarioId), source = loaded.source.scenarios.find(item => item.id === scenario.id);
  const runRoots = {...roots, runRoot: ownedFile(roots, executionId, runId)}, directory = controlDirectory(roots, executionId, runId), box = mailboxFactory(directory, runId, nonce);
  box.save({pid: process.pid});
  const controller = new AbortController(), privateEnvironment = consumerEnvironment(roots), protectedValues = new Map(), outputs = new Map(), diagnosticsState = {console: 0, requests: new Set()};
  const cleanupReserveMs = Math.min(5 * 60 * 1000, Math.floor(run.inputs.limits.cleanupTimeoutMs / 2));
  const secrets = {}, privateValues = [];
  for (const step of scenario.steps.filter(step => step.login)) {
    const configured = loaded.freeze.environment.targets.browser[step.target].users[step.login.user], handle = step.login.user.toUpperCase().replaceAll('-', '_');
    for (const [field, reference] of Object.entries(configured)) {
      const value = privateEnvironment[reference.slice(4)]; requireThat(value, 'Selected login secret is unavailable.');
      const category = field.replace(/Ref$/, '').toUpperCase(); secrets[`HARNESS_${category}_${handle}`] = value; privateValues.push(value);
    }
  }
  for (const input of run.inputs.values.filter(item => item.sensitivity === 'sensitive')) {
    const value = privateEnvironment[input.protectedRef.slice(10)]; requireThat(value !== undefined && value !== '', 'Protected input is unavailable.'); protectedValues.set(input.protectedRef, value); privateValues.push(value);
  }
  const resolver = {resolveSensitive: reference => {requireThat(protectedValues.has(reference), 'Protected input is unavailable.'); return protectedValues.get(reference);},
    storeSensitive: value => {const reference = `protected:${randomUUID()}`; protectedValues.set(reference, value); privateValues.push(typeof value === 'string' ? value : JSON.stringify(value)); return reference;}};
  let phaseFrame = null, active = null, complete = false, stopped = false, commands = 0, lastCommand = Date.now(), finalState, loopFailure;
  const currentStep = () => phaseFrame?.steps[phaseFrame.cursor];
  const saveStatus = (patch = {}) => box.save({state: stopped ? 'STOPPING' : 'READY', phase: phaseFrame?.phase ?? 'STARTING', step: currentStep()?.id ?? null,
    attempt: active?.context?.identity.number ?? null, active: Boolean(active), ...patch});
  const finishStep = (frame, attempt) => {
    if (active === frame) active = null;
    if (stopped) return;
    for (const output of attempt?.outputs ?? []) outputs.set(output.name, {...outputs.get(output.name), ...output, family: frame.step.family});
    phaseFrame.cursor++; saveStatus(); if (phaseFrame.cursor >= phaseFrame.steps.length) phaseFrame.done.resolve();
  };
  const bindings = step => (step.inputs ?? []).map(binding => {
    if (!binding.source.startsWith('output:')) return phaseFrame.context.value(binding.name);
    const output = outputs.get(binding.source.slice(7)); requireThat(output, 'Earlier output is unavailable.');
    const {family, subject, ...typed} = output; return {...typed, name: binding.name};
  });
  let stopping, stopReason;
  const interrupt = (reason, {integrity = false} = {}) => {
    if (stopping) return stopping;
    stopped = true; stopReason = reason;
    stopping = (async () => {
      const frame = active;
      if (frame?.commands && !frame.closing) {
        frame.closing = true; frame.commands.ledger.poisoned = true;
        if (!integrity) try {await frame.commands.finalize('uncertain', {interrupted: true});} catch { /* Core assessment remains authoritative, including integrity failures. */ }
      }
    })().finally(() => {controller.abort(); active?.done?.resolve(); phaseFrame?.done.resolve();});
    return stopping;
  };
  const callbacks = Object.fromEntries([['setup', 'SETUP'], ['exercise', 'EXERCISE'], ['verify', 'VERIFY'], ['cleanup', 'CLEANUP']].map(([name, phase]) => [name, async context => {
    const steps = scenario.steps.filter(step => step.phase === phase || phase === 'CLEANUP' && step.phase === 'RESTORE');
    phaseFrame = {context, phase, steps, cursor: 0, done: deferred()};
    if (!steps.length || stopped) return;
    const timer = phase === 'CLEANUP' ? setTimeout(() => {interrupt('CLEANUP_RESERVE').catch(error => {loopFailure ??= error;});}, run.inputs.limits.cleanupTimeoutMs - cleanupReserveMs) : undefined;
    try {saveStatus(); await phaseFrame.done.promise;} finally {clearTimeout(timer);}
  }]));
  const browser = scenario.browserTarget ? {target: scenario.browserTarget, secrets} : undefined;
  if (browser) {
    const login = scenario.steps.find(step => step.login), state = login && ownedFile(roots, executionId, `auth/${browser.target}-${login.login.user}.json`);
    if (state && existsSync(state)) browser.storageState = state;
  }
  const execution = runtime(run, runRoots, {signal: controller.signal, cleanupReserveMs, boundedObservations: true, api: resolver, database: resolver, ...(browser ? {browser} : {})}, callbacks)
    .then(result => {complete = true; finalState = stopped ? 'INTERRUPTED' : 'FINISHED'; updateRun(roots, executionId, runId, {state: finalState, endedAt: Date.now()}); box.save({state: 'FINISHING', active: false, verdict: result.status}); return result;}, error => {
      complete = true; const state = existsSync(join(runRoots.runRoot, 'observations.json')) ? 'INTEGRITY_FAILURE' : 'INTERRUPTED';
      finalState = state; updateRun(roots, executionId, runId, {state, endedAt: Date.now()}); box.save({state: 'FINISHING', active: false, reason: state === 'INTEGRITY_FAILURE' ? 'Assessment rejected the recorded execution.' : 'Execution did not finish.'}); return undefined;
    });
  // The command loop observes settlement below; keep a rejected completion
  // record from becoming an unhandled rejection while it is handling a reply.
  execution.catch(error => {loopFailure ??= error;});
  const begin = async stepId => {
    requireThat(phaseFrame && !active && currentStep()?.id === stepId, 'Begin the next frozen step.');
    const step = currentStep(), input = {operation: step.operation, invocationId: step.id, inputs: bindings(step), retry: step.capability === 'reads', ...(step.phase === 'RESTORE' ? {phase: 'RESTORE'} : {})};
    if (step.family !== 'browser') {
      input.unresolvedChecks = step.contracts.filter(contract => contract.synthetic || contract.condition.ambiguous).map(contract => contract.id);
      const created = step.creates?.[0]; if (created) input.resource = {id: created.resource, output: created.identityOutput, ownership: 'harness', intent: created.intent};
      if (step.cleanupResource) input.lifecycle = {resourceId: step.cleanupResource};
      const frame = {step}; active = frame; saveStatus();
      try {
        const attempt = await phaseFrame.context[step.family].execute(input);
        if (phaseFrame.context.observationBudgetReached()) {await interrupt('OBSERVATION_LIMIT'); return {status: 'FINISH_REQUIRED', reason: 'OBSERVATION_LIMIT', step: step.id, outcome: attempt.outcome, assertions: attempt.assertions};}
        finishStep(frame, attempt); return {status: 'STEP_COMPLETE', step: step.id, outcome: attempt.outcome, assertions: attempt.assertions};
      } catch (error) {active = null; if (error.code === 'OBSERVATION_LIMIT') await interrupt(error.code); else phaseFrame.done.reject(error); throw error;}
    }
    requireThat(phaseFrame.context.browser, 'Browser runtime is unavailable.');
    const started = deferred(), frame = {step, started}; active = frame;
    frame.execution = phaseFrame.context.browser.attempt(input, async context => {
      frame.context = context; frame.done = deferred(); frame.closing = false;
      frame.commands = new BrowserCommands({context, step, sourceScenario: source, references: loaded.freeze.referenceValues, outputs, roots: runRoots, executionId, runId, privateValues,
        diagnostics: loaded.execution.diagnostics, diagnosticsState, lastBrowserStep: step.id === scenario.steps.filter(item => item.family === 'browser').at(-1).id});
      saveStatus(); started.resolve(); await frame.done.promise;
    }).then(attempt => finishStep(frame, attempt), error => {active = null; phaseFrame.done.reject(error); started.reject(error);});
    frame.execution.catch(error => {loopFailure ??= error; phaseFrame?.done.reject(error); started.reject(error);});
    await started.promise; return {status: 'STEP_ACTIVE', step: step.id, attempt: frame.context.identity.number, contracts: step.contracts,
      ...(step.login ? {login: {user: step.login.user, secretNames: Object.keys(secrets).filter(name => name.endsWith(step.login.user.toUpperCase().replaceAll('-', '_'))), reuseLandmark: step.login.landmark ?? null}} : {})};
  };
  const dispatch = async args => {
    const [command, ...rest] = args;
    if (command === 'status') return {...box.state, nextStep: currentStep() ?? null};
    requireThat(!stopped || command === 'stop' || command === 'finish-scenario', 'SCENARIO_STOPPING');
    if (command === 'begin-step') return begin(rest[0]);
    if (command === 'skip-step') {requireThat(!active && currentStep()?.id === rest[0] && currentStep().optional === true && !currentStep().contracts.length && !(currentStep().creates?.length) && !currentStep().cleanupResource, 'Only optional steps with no required expectations or resource obligations may be skipped.'); phaseFrame.cursor++; saveStatus(); if (phaseFrame.cursor >= phaseFrame.steps.length) phaseFrame.done.resolve(); return {status: 'STEP_SKIPPED', step: rest[0]};}
    if (command === 'stop' || command === 'finish-scenario') {
      if (command === 'finish-scenario') requireThat(!active && (!currentStep() || complete), 'Finish all frozen steps before finishing the scenario.');
      else await interrupt('USER_STOP');
      await execution; return {status: finalState, runId};
    }
    requireThat(active?.commands && !active.closing, 'Begin a browser step before sending live commands.');
    if (command === 'end-step') {
      const {options} = parseOptions(rest); requireThat(options.effect === undefined || ['none', 'confirmed', 'not-executed', 'uncertain'].includes(options.effect), 'Unsupported effect certainty.');
      const frame = active; frame.closing = true;
      try {const result = await frame.commands.finalize(options.effect); frame.done.resolve(); return result;}
      catch (error) {frame.closing = false; throw error;}
    }
    return active.commands.dispatch(args);
  };
  try {
    while (!complete) {
      if (loopFailure) throw loopFailure;
      if (!stopped && (Date.now() - lastCommand > idleMs || commands >= 3000)) {
        await interrupt('HOST_LIMIT');
      }
      const request = box.take(); if (!request) {await delay(50); continue;}
      commands++; lastCommand = Date.now();
      let reply;
      try {reply = request.cached ?? await dispatch(request.args);}
      catch (error) {
        if (error.code === 'EVIDENCE_INTEGRITY_FAILURE') await interrupt(error.code, {integrity: true});
        else if (error.code === 'OBSERVATION_LIMIT') await interrupt(error.code);
        reply = {status: 'ERROR', reason: redact(String(error.message).slice(0, 4000), privateValues), ...(error.detail ? {detail: redact(error.detail, privateValues)} : {})};
      }
      if (!stopped && active?.commands && !active.closing && (active.commands.ledger.finishRequired || active.context.observationBudgetReached())) {
        await interrupt('OBSERVATION_LIMIT'); reply = {...reply, status: 'FINISH_REQUIRED', reason: 'OBSERVATION_LIMIT'};
      }
      try {reply = data(redact(reply, privateValues), 256 * 1024);} catch {reply = {status: 'ERROR', reason: 'Command reply exceeded its bounded format.'};}
      box.reply(request, reply);
    }
    return await execution;
  } catch (error) {
    await interrupt('HOST_ERROR');
    try {await execution;} catch { /* Persisted runtime observations remain the authority. */ }
    finalState = 'INTERRUPTED'; try {updateRun(roots, executionId, runId, {state: finalState, endedAt: Date.now()});} catch { /* A persistence fault cannot claim a successful completion. */ }
    throw error;
  } finally {
    protectedValues.clear();
    // Native cleanup removes protected storage only after proving owned process
    // absence. Keep the creation-identity lock if that proof is incomplete.
    if (!existsSync(join(runRoots.runRoot, 'protected'))) await releaseHost(roots, nonce);
    try {box.save({state: finalState ?? 'INTERRUPTED', ...(stopReason ? {stopReason} : {})});} catch { /* Ownership is retained when native cleanup still needs recovery. */ }
  }
}

export async function startScenario(roots, executionId, {rerun, foreground = false, readyTimeoutMs = 60000} = {}) {
  const loaded = readFrozen(roots, executionId), scenario = rerun ? loaded.freeze.scenarios.find(item => item.id === rerun) : loaded.freeze.scenarios.find(item => !loaded.execution.runs.some(run => run.scenarioId === item.id));
  requireThat(scenario || !rerun, 'Unknown rerun scenario.'); if (!scenario) return {status: 'EXECUTION_COMPLETE', executionId};
  const readiness = scopedReadiness(roots, loaded.freeze, scenario.id); requireThat(readiness.ready, `Selected scenario is missing environment references: ${readiness.missing.join(', ')}`);
  const runId = `run-${randomUUID()}`, lock = await acquireLauncher(roots, {executionId, runId}), input = runInput(loaded.freeze, loaded.source.scenarios.find(item => item.id === scenario.id), scenario, runId), run = createRun(input);
  const snapshot = {version: 1, executionId, scenarioId: scenario.id, runId, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input, explicitRerun: Boolean(rerun)};
  writeJson(ownedFile(roots, executionId, `snapshots/${runId}.json`), snapshot, {exclusive: true});
  saveExecution(roots, executionId, {...loaded.execution, runs: [...loaded.execution.runs, {runId, scenarioId: scenario.id, state: 'STARTING', startedAt: input.startedAt, explicitRerun: Boolean(rerun)}]});
  if (foreground) {console.log(JSON.stringify({status: 'STARTING', executionId, runId, foreground: true})); return runHostedScenario(roots, executionId, runId, lock.nonce);}
  const control = controlDirectory(roots, executionId, runId); mkdirSync(control, {recursive: true, mode: 0o700}); protect(control);
  const log = openSync(join(control, 'host.log'), 'wx', 0o600);
  const child = spawn(process.execPath, [join(roots.packageRoot, 'scripts/execute-test.mjs'), '--project-root', roots.projectRoot, '_host', executionId, runId, lock.nonce], {cwd: roots.projectRoot, detached: true, windowsHide: true, stdio: ['ignore', log, log]}); closeSync(log);
  child.on('error', () => {}); child.unref();
  if (child.pid) try {await recordSpawned(roots, lock.nonce, await processIdentity(child.pid));} catch { /* A fast host may already have finished and released ownership. */ }
  const deadline = Date.now() + readyTimeoutMs, hostFile = join(control, 'host.json');
  while (Date.now() < deadline) {
    if (existsSync(hostFile)) {const host = readBounded(hostFile); if (host.state === 'READY' || terminal.has(host.state)) return {status: host.state, executionId, runId, scenarioId: scenario.id, step: host.step ?? null};}
    await delay(100);
  }
  const current = await lockStatus(roots);
  // Ownership handoff already happened: only the host can recover its session.
  if (current?.nonce === lock.nonce && current.state === 'running') return {status: 'HOST_STARTING_SLOW', executionId, runId};
  return {status: 'STARTING', executionId, runId, reason: 'Inspect status before retrying; the launcher has not proven process absence.'};
}
