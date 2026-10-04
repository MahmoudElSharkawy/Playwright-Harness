import {writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {BrowserCommands} from '../../scripts/lib/execute/commands.mjs';
import {NativeFailure} from '../../scripts/lib/browser/native-cli.mjs';
import {verifyEvidence} from '../../scripts/lib/execution-core/index.mjs';
export function commandFixture(root, {text = 'Save', disabled = true, predicate = 'state:disabled', expected = null, verificationOnly = true, diagnostics = 'off', lastBrowserStep = false, core} = {}) {
  const calls = [], assertions = [], evidence = new Map(), outputs = new Map(); let fail = false, value = 'A', snapshot;
  const context = {identity: {runId: 'run1', scenarioId: 'case1', attemptId: 'attempt1', operationId: 's1', invocationId: 's1', number: 1, phase: 'EXERCISE'}, file: name => join(root, name),
    native: async args => {calls.push(['native', ...args]); if (fail) throw new NativeFailure('EXECUTOR', true, false, 'Target disappeared.', 'COMMAND_ERROR');
      const file = args.find(arg => arg.startsWith('--filename='))?.slice(11);
      if (args[0] === 'snapshot') writeFileSync(file, snapshot ?? `- button "Save" [ref=e1]\n- textbox "Name" [ref=e2]\n- region "Results" [ref=e3]\n${text}`);
      if (args[0] === 'eval') {const kind = args[1].match(/harness-read:(\w+)/)?.[1], actual = kind === 'state' ? {disabled, enabled: !disabled} : kind === 'value' ? value : text; writeFileSync(file, JSON.stringify({value: actual, coverage: {complete: true, gaps: []}}));}
      if (args[0] === 'screenshot') writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex')); return {result: 'OK'};},
    diagnostic: async args => {calls.push(['diagnostic', ...args]); return {notice: false, reply: {result: args[0] === 'console' ? 'Total messages: 0 (Errors: 0, Warnings: 0)' : ''}};},
    evidence: async (kind, value) => {const id = `command-${evidence.size + 1}`; if (core) core.evidence(core.current, kind, id, JSON.stringify(value)); evidence.set(id, {kind, value}); calls.push(['evidence', kind]); return id;},
    verifyEvidence: () => {calls.push(['verifyEvidence']); if (core) for (const record of core.report.evidence) verifyEvidence(core.run, core.roots, record);},
    observationBudgetReached: () => false,
    artifact: async (kind, path, sanitize) => {const bytes = sanitize(readFileSync(path)), id = `command-${evidence.size + 1}`; if (core) core.evidence(core.current, kind, id, bytes); evidence.set(id, {kind, bytes}); calls.push(['artifact', kind]); return id;},
    commit: staged => {for (const item of staged.assertions) {assertions.push(item); calls.push(['assertion']);} for (const item of staged.resources) calls.push(['resource', item]); for (const item of staged.lifecycles) calls.push(['lifecycle', item.resourceId, item.update]); if (staged.reconciliation) calls.push(['reconciliation', staged.reconciliation]); calls.push(['effect', staged.effect]);},
    assertion: value => {assertions.push(value); calls.push(['assertion']);}, effect: value => calls.push(['effect', value]), reconciliation: value => calls.push(['reconciliation', value]), retryAfterReconciliation: () => calls.push(['retry']),
    output: input => ({...input, producer: {runId: 'run1', scenarioId: 'case1', attemptId: 'attempt1', name: input.name}}), resource: value => calls.push(['resource', value]), lifecycle: (resource, value) => calls.push(['lifecycle', resource, value])};
  const condition = {text: predicate === 'state:disabled' ? 'Save is disabled' : 'Name equals A', predicate, subject: {element: {role: predicate === 'state:disabled' ? 'button' : 'textbox', name: predicate === 'state:disabled' ? 'Save' : 'Name'}}, expected, precondition: false, exact: false, ambiguous: false};
  const step = {id: 's1', capability: 'mutations', verificationOnly, contracts: [{id: 'c1', key: 'k1', index: 1, condition, synthetic: false}]};
  const commands = new BrowserCommands({context, step, sourceScenario: {bindings: {}, needsBinding: []}, references: {}, outputs, roots: {projectRoot: root}, executionId: 'exec1', runId: 'run1', diagnostics, lastBrowserStep});
  return {commands, context, step, calls, assertions, evidence, snapshot: value => {snapshot = value;}, fail: () => {fail = true;}, text: value => {text = value;}, value: next => {value = next;}, disabled: value => {disabled = value;}};
}
