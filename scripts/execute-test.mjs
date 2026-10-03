#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectArgument} from './lib/consumer-paths.mjs';
import {loadEnvironment} from './lib/project-config.mjs';
import {loadAdoConfiguration, adoId} from './lib/integrations/config.mjs';
import {createAdoClient} from './lib/integrations/ado-client.mjs';
import {createAdoTestSource} from './lib/integrations/ado-source.mjs';
import {requireThat} from './lib/execution-core/data.mjs';
import {prepareSource} from './lib/execute/source.mjs';
import {draftRefinement, freezeExecution, scopedReadiness} from './lib/execute/refinement.mjs';
import {createExecution, readExecution, readFrozen, readBounded} from './lib/execute/storage.mjs';
import {startScenario, runHostedScenario, deleteLogin, importLogin} from './lib/execute/host.mjs';
import {controlDirectory, sendCommand} from './lib/execute/mailbox.mjs';
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
    const captured = readExecution(roots, executionId), loaded = captured.execution.freezeFingerprint ? readFrozen(roots, executionId) : captured, current = await lockStatus(roots), latest = loaded.execution.runs.at(-1), path = latest && join(controlDirectory(roots, executionId, latest.runId), 'host.json');
    return {executionId, frozen: Boolean(loaded.freeze), lock: current?.executionId === executionId ? current : null, host: path && existsSync(path) ? readBounded(path) : null, ...(loaded.freeze ? {readiness: scopedReadiness(roots, loaded.freeze)} : {})};
  }
  if (command === 'do' || command === 'stop') {
    const loaded = readFrozen(roots, executionId), selected = loaded.execution.runs.at(-1); requireThat(selected, 'Start a scenario first.');
    const tail = rest.slice(1), protocol = {}; let runId = selected.runId;
    while (tail[0]?.startsWith('--') && ['--request-id', '--await', '--run'].includes(tail[0])) {const name = tail.shift(), value = tail.shift(); requireThat(value, 'Incomplete protocol option.'); if (name === '--run') runId = value; else protocol[name === '--await' ? 'awaitSeq' : 'requestId'] = name === '--await' ? Number(value) : value;}
    const directory = controlDirectory(roots, executionId, runId), host = readBounded(join(directory, 'host.json'));
    const environment = consumerEnvironment(roots);
    const secretRefs = loaded.freeze.scenarios.flatMap(scenario => scenario.steps.filter(step => step.login).flatMap(step => Object.values(loaded.freeze.environment.targets.browser[step.target].users[step.login.user])));
    for (const reference of secretRefs) {const value = environment[reference.slice(4)]; requireThat(!value || !tail.some(arg => arg.includes(value)), 'Use the configured native secret name; raw login values cannot enter the mailbox.');}
    const reply = ['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state) && (command === 'stop' || tail[0] === 'finish-scenario') ? {status: host.state, runId} : await sendCommand(directory, runId, command === 'stop' ? ['stop'] : tail, protocol);
    if (command === 'stop' && !tail.includes('--keep-login')) deleteLogin(roots, executionId); return reply;
  }
  if (command === 'report') {const {opt} = options(rest.slice(1), [], ['keep-login']); return writeExecutionReport(roots, executionId, {keepLogin: opt['keep-login']});}
  if (command === 'login-state') {const {positional} = options(rest.slice(1)); requireThat(positional[0] === 'import' && positional.length === 4, 'login-state <exec> import <target> <user> <file>'); return importLogin(roots, executionId, ...positional.slice(1));}
  if (command === 'file-bugs' || command === 'publish-results') {
    const {opt, positional} = options(rest.slice(1), ['recreate', 'drafts', 'point-map'], ['execute', 'include-changed', 'new-run']); requireThat(!positional.length, 'Unexpected delivery argument.');
    const {deliverExecution} = await import('./lib/execute/delivery.mjs'); return deliverExecution(roots, executionId, command, opt);
  }
  throw new Error('Use execute prepare, freeze, next, do, status, resume, stop, report, login-state, file-bugs or publish-results.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {const {roots, args} = projectArgument(); const result = await executeMain(roots, args); if (result) console.log(JSON.stringify(result, null, 2));}
  catch (error) {console.error(String(error.message).slice(0, 4000)); process.exitCode = 1;}
}
