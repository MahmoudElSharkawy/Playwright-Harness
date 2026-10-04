#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectArgument} from './lib/consumer-paths.mjs';
import {loadEnvironment} from './lib/project-config.mjs';
import {loadAdoConfiguration, adoId} from './lib/integrations/config.mjs';
import {createAdoClient} from './lib/integrations/ado-client.mjs';
import {createAdoTestSource} from './lib/integrations/ado-source.mjs';
import {requireThat, fingerprint} from './lib/execution-core/data.mjs';
import {prepareSource} from './lib/execute/source.mjs';
import {draftRefinement, freezeExecution, scopedReadiness} from './lib/execute/refinement.mjs';
import {createExecution, readExecution, readFrozen, readBounded, readOptional, ownedFile, publishExclusive} from './lib/execute/storage.mjs';
import {startScenario, runHostedScenario, deleteLogin, importLogin} from './lib/execute/host.mjs';
import {controlDirectory, sendCommand, delay} from './lib/execute/mailbox.mjs';
import {isSnapshotRef} from './lib/browser/snapshot.mjs';
import {lockStatus} from './lib/execute/lock.mjs';
import {consumerEnvironment} from './lib/consumer-env.mjs';
import {collectExecution, writeExecutionReport} from './lib/execute/report.mjs';

function options(args, values = [], flags = []) {
  const positional = [], opt = {};
  for (let index = 0; index < args.length; index++) {
    if (!args[index].startsWith('--')) {positional.push(args[index]); continue;}
    const name = args[index].slice(2); requireThat(!Object.hasOwn(opt, name), 'Duplicate option.');
    if (flags.includes(name)) opt[name] = true;
    else {requireThat(values.includes(name) && args[index + 1] && !args[index + 1].startsWith('--'), 'Unknown or incomplete option.'); opt[name] = args[++index];}
  }
  return {positional, opt};
}
export async function executeMain(roots, args) {
  const [command, ...rest] = args;
  if (command === '_host') {await runHostedScenario(roots, ...rest); return undefined;}
  if (command === 'prepare') {
    const {positional, opt} = options(rest, ['plan', 'environment', 'diagnostics'], ['checkpoint']);
    requireThat(positional.length === 2 && ['suite', 'story'].includes(positional[0]) && ['end', 'per-step', 'off'].includes(opt.diagnostics ?? 'end'), 'prepare suite|story <id> [--plan <id>] [--environment <name>] [--checkpoint] [--diagnostics end|per-step|off]');
    const configured = loadAdoConfiguration(roots), client = createAdoClient({...configured, roots}), source = createAdoTestSource(client), selected = adoId(positional[1]), environment = loadEnvironment(roots, opt.environment);
    const planId = positional[0] === 'suite' ? adoId(opt.plan ?? configured.configuration.planId) : undefined;
    const fetched = positional[0] === 'suite' ? await source.fetchSuite(planId, selected, {tolerant: true}) : await source.fetchStory(selected, ['tested-by'], {tolerant: true});
    const captured = prepareSource(fetched, positional[0] === 'suite' ? {kind: 'suite', planId, suiteId: selected} : {kind: 'story', storyId: selected});
    const refinement = draftRefinement(captured, environment), result = createExecution(roots, captured, refinement, {checkpoint: opt.checkpoint, diagnostics: opt.diagnostics});
    return {...result, status: 'PREPARED', refinement: `${result.directory}/refinement.json`, readiness: scopedReadiness(roots, {environment, scenarios: refinement.scenarios})};
  }
  const executionId = rest[0]; requireThat(executionId, 'An execution ID is required.');
  if (command === 'freeze') return freezeExecution(roots, executionId);
  if (command === 'next' || command === 'resume') {
    const {opt, positional} = options(rest.slice(1), ['rerun'], ['foreground']); requireThat(!positional.length, 'Unexpected next argument.');
    let rerun = opt.rerun;
    if (command === 'resume' && !rerun) {const view = collectExecution(roots, executionId); rerun = view.scenarios.find(row => ['INTERRUPTED', 'INTEGRITY_FAILURE'].includes(row.state))?.id;}
    return startScenario(roots, executionId, {rerun, foreground: opt.foreground});
  }
  if (command === 'status') {
    const execution = readBounded(ownedFile(roots, executionId, 'execution.json')), current = await lockStatus(roots), latest = execution.runs.at(-1), path = latest && join(controlDirectory(roots, executionId, latest.runId), 'host.json'), host = path ? readOptional(path) : null;
    requireThat(execution.id === executionId && execution.version === 1, 'Wrong execution identity.');
    return {executionId, frozen: Boolean(execution.freezeFingerprint), checkpoint: execution.checkpoint, startUrl: host?.startUrl ?? null, lock: current?.executionId === executionId ? current : null, host,
      ...(rest.includes('--readiness') && execution.freezeFingerprint ? {readiness: scopedReadiness(roots, readFrozen(roots, executionId).freeze)} : {})};
  }
  if (command === 'do' || command === 'stop') {
    const execution = readBounded(ownedFile(roots, executionId, 'execution.json')), selected = execution.runs.at(-1); requireThat(selected && execution.id === executionId, 'Start a scenario first.');
    const tail = rest.slice(1), protocol = {}; let runId = selected.runId;
    while (tail[0]?.startsWith('--') && ['--request-id', '--await', '--run'].includes(tail[0])) {const name = tail.shift(), value = tail.shift(); requireThat(value, 'Incomplete protocol option.'); if (name === '--run') runId = value; else protocol[name === '--await' ? 'awaitSeq' : 'requestId'] = name === '--await' ? Number(value) : value;}
    const directory = controlDirectory(roots, executionId, runId), host = readBounded(join(directory, 'host.json'));
    requireThat(host.runId === runId, 'WRONG_RUN');
    if (command === 'stop') {
      const terminal = new Set(['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE']); let current = host;
      if (!terminal.has(current.state)) {
        try {publishExclusive(join(directory, 'stop.request'), JSON.stringify({runId, channel: host.channel}));} catch (error) {if (error.code !== 'EEXIST') throw error;}
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline && !terminal.has(current.state)) {await delay(100); current = readBounded(join(directory, 'host.json'));}
      }
      if (terminal.has(current.state) && !tail.includes('--keep-login')) deleteLogin(roots, executionId);
      return {status: terminal.has(current.state) ? current.state : 'STOP_REQUESTED', runId};
    }
    const environment = consumerEnvironment(roots);
    let secretRefs;
    if (execution.guardRefs && host.guardRefsFingerprint && !['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state)) {
      const owner = await lockStatus(roots);
      requireThat(execution.runs.some(item => item.runId === runId) && owner?.executionId === executionId && owner.runId === runId && owner.nonce === host.channel && owner.host?.pid === host.pid, 'Password guard cache has no matching host ownership.');
      requireThat(host.freezeFingerprint === execution.freezeFingerprint && host.guardRefsFingerprint === fingerprint(execution.guardRefs), 'Password guard cache differs from the verified host.'); secretRefs = execution.guardRefs;
    } else {const loaded = readFrozen(roots, executionId); secretRefs = loaded.freeze.scenarios.flatMap(scenario => scenario.steps.filter(step => step.login).map(step => loaded.freeze.environment.targets.browser[step.target].users[step.login.user].passwordRef));}
    const referenceArgument = index => tail[0] === 'native' && ['click', 'dblclick', 'fill', 'select', 'check', 'uncheck', 'hover', 'drag'].includes(tail[1]) && (index === 2 || tail[1] === 'drag' && index === 3) && isSnapshotRef(tail[index]);
    for (const reference of secretRefs) {const value = environment[reference.slice(4)]; requireThat(!value || !tail.some((arg, index) => arg.includes(value) && !referenceArgument(index)), 'Use the configured native secret name; raw login values cannot enter the mailbox.');}
    return ['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state) && tail[0] === 'finish-scenario' ? {status: host.state, runId} : sendCommand(directory, runId, tail, protocol);
  }
  if (command === 'report') {const {opt} = options(rest.slice(1), [], ['keep-login']); return writeExecutionReport(roots, executionId, {keepLogin: opt['keep-login']});}
  if (command === 'login-state') {const {positional} = options(rest.slice(1)); requireThat(positional[0] === 'import' && positional.length === 4, 'login-state <exec> import <target> <user> <file>'); return importLogin(roots, executionId, ...positional.slice(1));}
  if (command === 'file-bugs' || command === 'publish-results') {
    const {opt, positional} = options(rest.slice(1), ['recreate', 'drafts', 'point-map', 'include'], ['execute', 'include-changed', 'new-run']); requireThat(!positional.length, 'Unexpected delivery argument.');
    const {deliverExecution} = await import('./lib/execute/delivery.mjs'); return deliverExecution(roots, executionId, command, opt);
  }
  throw new Error('Use execute prepare, freeze, next, do, status, resume, stop, report, login-state, file-bugs or publish-results.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {const {roots, args} = projectArgument(); const result = await executeMain(roots, args); if (result) console.log(JSON.stringify(result, null, 2));}
  catch (error) {console.error(JSON.stringify({status: 'ERROR', reason: String(error.message).slice(0, 4000), ...(error.requestId ? {requestId: error.requestId, seq: error.seq ?? null} : {})})); process.exitCode = 1;}
}
