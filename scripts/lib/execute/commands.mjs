import {readFileSync, copyFileSync, mkdirSync, chmodSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {data, fingerprint, requireThat, id} from '../execution-core/data.mjs';
import {NativeFailure} from '../browser/native-cli.mjs';
import {VerdictLedger, matchingRead, compareRead, requireIndependent, aggregateSourceConditions} from './verdicts.mjs';
import {expectedValue, normalize} from './refinement.mjs';
import {delay} from './mailbox.mjs';
import {protect} from '../generation/storage.mjs';

const reads = new Set(['snapshot', 'find', 'tab-list']);
const changes = new Set(['goto', 'reload', 'back', 'forward', 'tab-new', 'tab-select', 'tab-close', 'resize', 'hover', 'mousewheel', 'mousemove', 'dialog-dismiss']);
const actions = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'keydown', 'keyup', 'select', 'check', 'uncheck', 'drag', 'mousedown', 'mouseup', 'dialog-accept']);
const targetCommands = new Set(['click', 'dblclick', 'fill', 'type', 'select', 'check', 'uncheck', 'hover', 'drag']);
const value = text => {try {return JSON.parse(text);} catch {return text;}};
export function parseOptions(args) {
  const positional = [], options = {};
  const names = new Set(['condition', 'read', 'value', 'source', 'wait', 'evidence', 'observed', 'rationale', 'actual', 'why-not-checked', 'reason', 'effect', 'name', 'exact']);
  for (let index = 0; index < args.length; index++) {
    if (!args[index].startsWith('--')) {positional.push(args[index]); continue;}
    const name = args[index].slice(2); requireThat(names.has(name) && !Object.hasOwn(options, name), 'Unknown or duplicate command option.');
    if (name === 'exact') options[name] = true;
    else {requireThat(args[index + 1] !== undefined && !args[index + 1].startsWith('--'), 'Incomplete command option.'); options[name] = args[++index];}
  }
  return {positional, options};
}
export function redact(value, privateValues = []) {
  const secrets = privateValues.filter(secret => typeof secret === 'string' && secret.length).sort((a, b) => b.length - a.length);
  const visit = input => {
    if (typeof input === 'string') {for (const secret of secrets) input = input.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]'); return input;}
    if (Array.isArray(input)) return input.map(item => item === undefined ? null : visit(item));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined).map(([key, item]) => [visit(key), visit(item)]));
    return input;
  };
  return visit(value);
}
export function snapshotRefs(text) {
  const refs = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*-\s+([a-z]+)(?:\s+"((?:\\.|[^"\\])*)")?.*?\[ref=(e\d+)\]/);
    if (match) refs.set(match[3], {kind: ['region', 'main', 'navigation', 'dialog', 'form', 'group'].includes(match[1]) ? 'region' : 'element', role: match[1], name: (match[2] ?? '').replace(/\\"/g, '"')});
  }
  return refs;
}
const elementTemplates = Object.freeze({
  text: '(element) => element.innerText ?? element.textContent ?? ""',
  value: '(element) => element.value ?? ""',
  region: '(element) => { const copy = element.cloneNode(true); copy.querySelectorAll("input,textarea,[contenteditable]").forEach(node => node.remove()); return copy.textContent ?? ""; }',
  state: '(element) => { const disabled = element.disabled === true || element.matches(":disabled") || element.getAttribute("aria-disabled") === "true"; const checked = element.checked === true || element.getAttribute("aria-checked") === "true"; const visible = element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"; return {enabled: !disabled, disabled, checked, unchecked: !checked, visible, hidden: !visible}; }'
});
const pageTemplate = '() => { const copy = document.body.cloneNode(true); copy.querySelectorAll("input,textarea,[contenteditable],script,style").forEach(node => node.remove()); return copy.textContent ?? ""; }';
export const countSelectors = Object.freeze({button: 'button,input[type="button"],input[type="submit"],input[type="reset"]', textbox: 'textarea,input:not([type]):not([list]),input[type="text"]:not([list]),input[type="email"]:not([list]),input[type="tel"]:not([list]),input[type="url"]:not([list])', link: 'a[href],area[href]', checkbox: 'input[type="checkbox"]'});
const stripQueries = text => text.replace(/https?:\/\/[^\s<>"']+/g, value => {try {const url = new URL(value); return `${url.origin}${url.pathname}`;} catch {return '[url]';}});
export function diagnosticDelta(kind, reply, state) {
  const text = typeof reply.result === 'string' ? reply.result : JSON.stringify(reply), lines = text.split('\n'), entries = [];
  if (kind === 'console') {
    const messages = lines.filter(line => /^\s*\[ERROR\]/i.test(line));
    for (const message of messages.slice(state.console ?? 0)) entries.push({kind: 'console', detail: stripQueries(message).slice(0, 4000)});
    state.console = messages.length;
    return {entries, clear: Number(text.match(/Total messages:\s*(\d+)/)?.[1] ?? 0) > 2000};
  }
  state.requests ??= new Set(); let maximum = 0;
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+\[([A-Z]+)\]\s+(https?:\/\/\S+)\s+=>\s+\[(\d+|FAILED)\]/); if (!match) continue;
    maximum = Math.max(maximum, Number(match[1])); const signature = `${match[1]}:${match[4]}`;
    if (state.requests.has(signature) || match[4] !== 'FAILED' && Number(match[4]) < 400) continue;
    const url = new URL(match[3]); state.requests.add(signature); entries.push({kind: 'request', method: match[2], origin: url.origin, path: url.pathname, status: match[4] === 'FAILED' ? 'FAILED' : Number(match[4])});
  }
  return {entries, clear: maximum > 2000};
}

/** Thin live command adapter. The agent cannot supply JavaScript or core assertion records. */
export class BrowserCommands {
  constructor({context, step, sourceScenario, references, outputs, roots, executionId, runId, privateValues = [], diagnostics = 'end', diagnosticsState = {console: 0, requests: new Set()}, lastBrowserStep = false}) {
    Object.assign(this, {context, step, sourceScenario, references, outputs, roots, executionId, runId, privateValues, diagnostics, diagnosticsState, lastBrowserStep});
    this.ledger = new VerdictLedger(step.contracts, {verificationOnly: step.verificationOnly || step.capability === 'reads', bindings: sourceScenario.bindings});
    this.artifacts = new Map(); this.latestSnapshot = null; this.typedSubjects = new Set(); this.failure = null; this.manualRetry = false; this.reconciled = null;
  }
  safe(value) {return redact(value, this.privateValues);}
  async native(args, {reconciliation = false} = {}) {
    const command = args[0]; requireThat(reads.has(command) || changes.has(command) || actions.has(command), 'COMMAND_REFUSED');
    requireThat(!actions.has(command) || this.step.capability === 'mutations', 'Mutation command requires a mutation step.');
    requireThat(!this.ledger.poisoned || reconciliation || reads.has(command), 'ATTEMPT_POISONED');
    requireThat(!args.some(arg => /^HARNESS_(PASSWORD|USERNAME)_/.test(arg)) || this.step.login, 'Login secret names are restricted to login steps.');
    if (targetCommands.has(command)) {
      this.ref(args[1]); if (command === 'drag') this.ref(args[2]);
      if (['fill', 'type'].includes(command)) {
        const subject = this.latestSnapshot.refs.get(args[1]); this.typedSubjects.add(fingerprint(subject));
        if (this.step.login && subject.name.toLowerCase().includes('password')) requireThat(/^HARNESS_PASSWORD_/.test(args[2]), 'Login passwords must use the configured secret name.');
      }
    }
    try {
      const reply = await this.context.native(args);
      if (changes.has(command) || actions.has(command)) this.ledger.changed();
      return this.safe(reply);
    } catch (error) {this.failure = error; this.ledger.poisoned = true; throw error;}
  }
  ref(reference) {
    requireThat(/^e\d+$/.test(reference ?? '') && this.latestSnapshot?.stateVersion === this.ledger.stateVersion && this.latestSnapshot.refs.has(reference), 'NOT_IN_SNAPSHOT');
    return this.latestSnapshot.refs.get(reference);
  }
  async snapshot() {
    const name = `snapshot-${randomUUID()}`, path = this.context.file(name);
    await this.native(['snapshot', `--filename=${path}`]);
    const text = this.safe(readFileSync(path, 'utf8')), artifact = await this.context.artifact('snapshot', path, bytes => Buffer.from(this.safe(bytes.toString('utf8'))));
    const record = {id: artifact, kind: 'snapshot', stateVersion: this.ledger.stateVersion, text, refs: snapshotRefs(text)};
    this.artifacts.set(artifact, record); this.latestSnapshot = record; return record;
  }
  async screenshot() {
    const path = this.context.file(`screenshot-${randomUUID()}`);
    // This host-owned observation is allowed after poisoning; it never establishes a new verdict.
    await this.context.native(['screenshot', `--filename=${path}`]);
    const artifact = await this.context.artifact('screenshot', path, bytes => {requireThat(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Invalid screenshot.'); return bytes;});
    const record = {id: artifact, kind: 'screenshot', stateVersion: this.ledger.stateVersion}; this.artifacts.set(artifact, record); return record;
  }
  async evaluate(template, reference) {
    const path = this.context.file(`read-${randomUUID()}`);
    try {await this.context.native(['eval', template, ...(reference ? [reference] : []), `--filename=${path}`]);}
    catch (error) {this.failure = error; this.ledger.poisoned = true; throw error;}
    requireThat(statSync(path).size <= 256 * 1024, 'Read output exceeds its bound.');
    const actual = JSON.parse(readFileSync(path, 'utf8'));
    requireThat(JSON.stringify(actual) === JSON.stringify(this.safe(actual)), 'Sensitive output cannot be checked or captured.');
    return actual;
  }
  async read(spec) {
    const parts = spec.trim().split(/\s+/), kind = parts[0];
    requireThat(['page', 'region', 'text', 'value', 'state', 'count', 'url'].includes(kind), 'Unsupported host read.');
    const snapshot = await this.snapshot(); let actual, subject = {kind: 'page'};
    if (kind === 'page') actual = await this.evaluate(pageTemplate);
    else if (kind === 'url') actual = await this.evaluate('() => location.href');
    else {
      subject = this.ref(parts[1]);
      if (kind === 'count') {requireThat(Object.hasOwn(countSelectors, parts[2]), 'Count supports button, textbox, link and checkbox roles.'); actual = await this.evaluate(`(element) => {const role = '${parts[2]}'; return [...element.querySelectorAll('[role="${parts[2]}"],${countSelectors[parts[2]]}')].filter(node => !node.hasAttribute('role') || node.getAttribute('role') === role).length;}`, parts[1]);}
      else actual = await this.evaluate(elementTemplates[kind], parts[1]);
    }
    const outputId = await this.context.evidence('observation', {readKind: kind, actual, subject, snapshotId: snapshot.id});
    this.artifacts.set(outputId, {id: outputId, kind: 'observation', stateVersion: this.ledger.stateVersion});
    return {kind, value: actual, subject, evidenceIds: [snapshot.id, outputId]};
  }
  async check(key, index, options) {
    const contract = this.ledger.condition(key, index); this.ledger.timing(contract);
    const resolved = expectedValue(contract.condition, this.sourceScenario, this.references, this.outputs);
    if (resolved.missing || resolved.assumed) return this.ledger.indeterminate(key, index, 'missing-reference-data');
    if (options.source) requireThat(options.source === resolved.source, 'Expected source differs from frozen source.');
    const supplied = options.value === undefined ? resolved.value : value(options.value), exact = Boolean(options.exact), wait = options.wait === undefined ? 0 : Number(options.wait);
    requireThat(Number.isInteger(wait) && wait >= 0 && wait <= 120000, 'Polling window must be 0–120000 ms.');
    const deadline = Date.now() + wait; let observation, agreementAt = null;
    while (true) {
      observation = await this.read(options.read); requireIndependent(contract.condition, resolved, observation, this.typedSubjects);
      const passed = compareRead(contract.condition, observation, supplied, exact), matching = matchingRead(contract.condition, observation, resolved, supplied, exact);
      if (contract.condition.predicate === 'absent' && passed && matching) {
        agreementAt ??= Date.now(); if (Date.now() - agreementAt >= 1000) break;
        await delay(1000); continue;
      }
      agreementAt = null;
      if (passed || Date.now() >= deadline) break; await delay(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    return this.ledger.checked(key, index, {read: observation, resolved, supplied, exact, evidenceIds: observation.evidenceIds, typedSubjects: this.typedSubjects});
  }
  async diagnosticsCapture() {
    const facts = [];
    for (const args of [['console', 'error'], ['requests']]) {
      try {
        const result = await this.context.diagnostic(args);
        if (result.notice) {facts.push({kind: args[0], notice: result.reason}); continue;}
        const delta = diagnosticDelta(args[0], this.safe(result.reply), this.diagnosticsState); facts.push(...delta.entries);
        if (delta.clear) {const cleared = await this.context.diagnostic([args[0], '--clear']); if (!cleared.notice) {if (args[0] === 'console') this.diagnosticsState.console = 0; else this.diagnosticsState.requests.clear();}}
      } catch (error) {this.failure = error; this.ledger.poisoned = true; throw error;}
    }
    const artifactId = await this.context.evidence('observation', {diagnostics: facts, partOfVerdict: false});
    this.artifacts.set(artifactId, {id: artifactId, kind: 'observation', stateVersion: this.ledger.stateVersion}); return facts;
  }
  async finalize(effect) {
    const bound = artifactId => this.artifacts.has(artifactId);
    let results = this.ledger.aggregate({artifactValid: bound});
    if (results.some(result => ['FAIL', 'INDETERMINATE'].includes(result.status))) try {await this.screenshot();} catch (error) {this.failure = error; this.ledger.poisoned = true;}
    if (this.diagnostics === 'per-step' || this.diagnostics === 'end' && (this.lastBrowserStep || results.some(result => ['FAIL', 'INDETERMINATE'].includes(result.status)))) try {await this.diagnosticsCapture();} catch { /* Preserve the underlying execution failure and historical assertions. */ }
    results = this.ledger.aggregate({artifactValid: bound});
    for (const result of results) {
      const assertionId = await this.context.evidence('assertion', {schema: 'execute-assertion/1', ...result.provenance, status: result.status, method: result.method});
      result.evidenceIds.push(assertionId); this.artifacts.set(assertionId, {id: assertionId, kind: 'assertion', stateVersion: this.ledger.stateVersion});
      const required = this.step.contracts.find(contract => contract.id === result.id)?.synthetic ? ['assertion'] : ['assertion', 'snapshot'];
      if (['PASS', 'FAIL'].includes(result.status) && !required.every(kind => result.evidenceIds.some(id => this.artifacts.get(id)?.kind === kind))) {result.status = 'INDETERMINATE'; result.reliable = false; result.reason = 'insufficient-evidence';}
    }
    const created = this.step.creates?.[0];
    if (created && !this.ledger.poisoned && effect === 'confirmed' && this.outputs.has(created.identityOutput)) {
      const output = this.outputs.get(created.identityOutput), action = created.intent === 'temporary' ? 'cleanup' : created.intent === 'persistent' ? 'retain' : 'none';
      this.context.resource({id: created.resource, identity: {attemptId: this.context.identity.attemptId, name: output.producer.name}, ownership: 'harness', intent: created.intent, lifecycle: {action, status: action === 'cleanup' ? 'pending' : 'not-required', evidenceIds: []}});
    }
    if (this.step.cleanupResource) {
      const complete = !this.failure && !this.ledger.poisoned && results.every(item => item.status === 'PASS') && effect === 'confirmed';
      const evidenceIds = [...new Set(results.flatMap(item => item.evidenceIds))], lifecycleId = await this.context.evidence('lifecycle', {resourceId: this.step.cleanupResource, complete, verificationArtifacts: evidenceIds});
      this.context.lifecycle(this.step.cleanupResource, {status: complete ? 'completed' : 'failed', evidenceIds: [lifecycleId, ...evidenceIds]});
    }
    for (const result of results) this.context.assertion({id: result.id, status: result.status, reliable: result.reliable, evidenceIds: result.evidenceIds});
    if (this.reconciled) this.context.reconciliation(this.reconciled);
    const resourceIds = [...(created && this.outputs.has(created.identityOutput) && !this.ledger.poisoned && effect === 'confirmed' ? [created.resource] : []), ...(this.step.cleanupResource && effect === 'confirmed' ? [this.step.cleanupResource] : [])];
    if (!this.ledger.poisoned && (effect || this.step.capability === 'reads')) this.context.effect({certainty: created && !resourceIds.length ? 'uncertain' : effect ?? 'none', resourceIds});
    if (this.manualRetry) this.context.retryAfterReconciliation();
    return {status: 'STEP_ENDING', conditions: results.map(({id, status, method}) => ({id, status, method})), expectations: aggregateSourceConditions(results)};
  }
  async dispatch(args) {
    const [command, ...rest] = args;
    if (command === 'native') return {status: 'OK', reply: await this.native(rest)};
    if (command === 'look') {const snapshot = await this.snapshot(); return {status: 'OK', snapshot: snapshot.text, evidenceId: snapshot.id, stateVersion: snapshot.stateVersion};}
    const {positional, options} = parseOptions(rest), key = positional[0], index = Number(options.condition ?? 1);
    if (command === 'check') {requireThat(options.read, 'Check needs --read.'); return {status: 'OK', result: await this.check(key, index, options)};}
    if (command === 'observe') {
      const ids = String(options.evidence ?? '').split(',').filter(Boolean), artifacts = ids.map(id => this.artifacts.get(id)); requireThat(artifacts.every(Boolean), 'Unknown observation artifact.');
      return {status: 'OK', result: this.ledger.observed(key, index, {status: positional[1], observed: options.observed, rationale: options.rationale, actual: options.actual, whyNotChecked: options['why-not-checked'], artifacts})};
    }
    if (command === 'indeterminate') return {status: 'OK', result: this.ledger.indeterminate(key, index, options.reason)};
    if (command === 'invalidate') return {status: 'OK', result: this.ledger.invalidate(Number(key), options.reason)};
    if (command === 'evidence') {const artifact = key === 'snapshot' ? await this.snapshot() : key === 'screenshot' ? await this.screenshot() : null; requireThat(artifact, 'Evidence kind must be snapshot or screenshot.'); return {status: 'OK', evidenceId: artifact.id};}
    if (command === 'note') {const artifactId = await this.context.evidence('observation', {note: positional.join(' ')}); this.artifacts.set(artifactId, {id: artifactId, kind: 'observation', stateVersion: this.ledger.stateVersion}); return {status: 'OK', evidenceId: artifactId};}
    if (command === 'capture') {
      id(key); requireThat(!this.outputs.has(key) && options.read, 'Capture needs a new output name and a host read.');
      const read = await this.read(options.read), captured = this.context.output({name: key, type: read.value === null ? 'null' : Array.isArray(read.value) ? 'array' : typeof read.value, sensitivity: 'public', value: read.value});
      this.outputs.set(key, {...captured, family: 'browser', subject: read.subject}); return {status: 'OK', output: captured};
    }
    if (command === 'reconcile') {
      requireThat(['no-effect', 'effect', 'inconclusive'].includes(key), 'Invalid reconciliation.');
      if (key === 'effect' && this.step.creates?.[0]) requireThat(this.outputs.has(this.step.creates[0].identityOutput), 'Capture the created resource identity before confirming its effect.');
      const ids = String(options.evidence ?? '').split(',').filter(Boolean); requireThat(ids.length && ids.every(id => this.artifacts.has(id)), 'Reconciliation needs registered evidence.');
      const kind = key === 'no-effect' ? 'confirmed-no-effect' : key === 'effect' ? 'confirmed-effect' : 'inconclusive';
      const artifactId = await this.context.evidence('reconciliation', {kind, supportingIds: ids});
      this.reconciled = {kind, evidenceIds: [artifactId]}; this.context.reconciliation(this.reconciled);
      if (kind === 'confirmed-no-effect') this.manualRetry = true;
      else if (kind === 'confirmed-effect') this.ledger.poisoned = false;
      return {status: 'OK', kind};
    }
    if (command === 'save-login') {
      requireThat(this.step.login && this.step.login.landmark && this.latestSnapshot && normalize(this.latestSnapshot.text).includes(normalize(this.step.login.landmark)), 'Login landmark has not been observed.');
      const path = this.context.file(`login-${randomUUID()}`); await this.context.native(['state-save', path]); requireThat(statSync(path).size <= 2 * 1024 * 1024, 'Login state exceeds its bound.');
      const directory = join(this.roots.projectRoot, '.harness/runs', this.executionId, 'auth'); mkdirSync(directory, {recursive: true, mode: 0o700}); protect(directory); const saved = join(directory, `${this.step.target}-${this.step.login.user}.json`); copyFileSync(path, saved); chmodSync(saved, 0o600);
      return {status: 'LOGIN_SAVED', target: this.step.target, user: this.step.login.user};
    }
    throw new Error('Unknown execution command.');
  }
}
