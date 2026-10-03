import {writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {BrowserCommands} from '../../scripts/lib/execute/commands.mjs';
import {NativeFailure} from '../../scripts/lib/browser/native-cli.mjs';
export function commandFixture(root, {text = 'Save', disabled = true, predicate = 'state:disabled', expected = null, verificationOnly = true, diagnostics = 'off', lastBrowserStep = false} = {}) {
  const calls = [], assertions = [], evidence = new Map(), outputs = new Map(); let fail = false, value = 'A';
  const context = {identity: {runId: 'run1', scenarioId: 'case1', attemptId: 'attempt1', operationId: 's1', invocationId: 's1', number: 1, phase: 'EXERCISE'}, file: name => join(root, name),
    native: async args => {calls.push(['native', ...args]); if (fail) throw new NativeFailure('EXECUTOR', true, 'COMMAND_ERROR', 'Target disappeared.');
      const file = args.find(arg => arg.startsWith('--filename='))?.slice(11);
      if (args[0] === 'snapshot') writeFileSync(file, `- button "Save" [ref=e1]\n- textbox "Name" [ref=e2]\n- region "Results" [ref=e3]\n${text}`);
      if (args[0] === 'eval') {const actual = args[1].includes('getClientRects') ? {disabled, enabled: !disabled} : args[1].includes('element.value') ? value : text; writeFileSync(file, JSON.stringify(actual));}
      if (args[0] === 'screenshot') writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex')); return {result: 'OK'};},
    diagnostic: async args => {calls.push(['diagnostic', ...args]); return {notice: false, reply: {result: args[0] === 'console' ? 'Total messages: 0 (Errors: 0, Warnings: 0)' : ''}};},
    evidence: async (kind, value) => {const id = `artifact-${evidence.size + 1}`; evidence.set(id, {kind, value}); calls.push(['evidence', kind]); return id;},
    artifact: async (kind, path, sanitize) => {const bytes = sanitize(readFileSync(path)), id = `artifact-${evidence.size + 1}`; evidence.set(id, {kind, bytes}); calls.push(['artifact', kind]); return id;},
    assertion: value => {assertions.push(value); calls.push(['assertion']);}, effect: value => calls.push(['effect', value]), reconciliation: value => calls.push(['reconciliation', value]), retryAfterReconciliation: () => calls.push(['retry']),
    output: input => ({...input, producer: {runId: 'run1', scenarioId: 'case1', attemptId: 'attempt1', name: input.name}}), resource: value => calls.push(['resource', value]), lifecycle: (resource, value) => calls.push(['lifecycle', resource, value])};
  const condition = {text: predicate === 'state:disabled' ? 'Save is disabled' : 'Name equals A', predicate, subject: {element: {role: predicate === 'state:disabled' ? 'button' : 'textbox', name: predicate === 'state:disabled' ? 'Save' : 'Name'}}, expected, precondition: false, exact: false, ambiguous: false};
  const step = {id: 's1', capability: 'mutations', verificationOnly, contracts: [{id: 'c1', key: 'k1', index: 1, condition, synthetic: false}]};
  const commands = new BrowserCommands({context, step, sourceScenario: {bindings: {}, needsBinding: []}, references: {}, outputs, roots: {projectRoot: root}, executionId: 'exec1', runId: 'run1', diagnostics, lastBrowserStep});
  return {commands, context, step, calls, assertions, evidence, fail: () => {fail = true;}, text: value => {text = value;}, value: next => {value = next;}, disabled: value => {disabled = value;}};
}
