import {readFileSync, copyFileSync, mkdirSync, chmodSync, statSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {data, fingerprint, requireThat, id} from '../execution-core/data.mjs';
import {NativeFailure} from '../browser/native-cli.mjs';
import {VerdictLedger, matchingRead, compareRead, requireIndependent, aggregateSourceConditions, assertionEvidence} from './verdicts.mjs';
import {expectedValue, normalize} from './refinement.mjs';
import {delay} from './mailbox.mjs';
import {protect} from '../generation/storage.mjs';
import {snapshotRefs, isSnapshotRef} from '../browser/snapshot.mjs';
import {readTemplate} from './reads.mjs';
import {secretFindings} from '../package-validation.mjs';
import {ownedFile} from './storage.mjs';
import {validateCliGrammar} from '../browser/grammar.mjs';
export {snapshotRefs} from '../browser/snapshot.mjs';

const reads = new Set(['snapshot', 'find', 'tab-list']);
const changes = new Set(['goto', 'reload', 'go-back', 'go-forward', 'tab-new', 'tab-select', 'tab-close', 'resize', 'hover', 'mousewheel', 'mousemove', 'dialog-dismiss']);
const actions = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'keydown', 'keyup', 'select', 'check', 'uncheck', 'drag', 'mousedown', 'mouseup', 'dialog-accept']);
const targetCommands = new Set(['click', 'dblclick', 'fill', 'select', 'check', 'uncheck', 'hover', 'drag']);
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
export function sensitiveLeaves(privateValues) {
  const found = new Set(); let nodes = 0;
  const walk = (value, depth = 0) => {
    if (++nodes > 2000 || depth > 8) return;
    if (typeof value === 'string' && value.length) {
      found.add(value);
      if (value.length > 32768) return;
      try {const parsed = JSON.parse(value); if (parsed !== value && parsed && typeof parsed === 'object') walk(parsed, depth + 1);} catch {}
      if (/^[^=&\s]+=[^]*$/.test(value)) for (const item of new URLSearchParams(value).values()) if (item !== value) walk(item, depth + 1);
    } else if (typeof value === 'number') found.add(String(value));
    else if (Array.isArray(value)) for (const item of value) walk(item, depth + 1);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item, depth + 1);
  };
  for (const value of privateValues) walk(value);
  return [...found].flatMap(secret => [secret, encodeURIComponent(secret), encodeURIComponent(secret).replace(/%20/g, '+'), encodeURIComponent(encodeURIComponent(secret))]).sort((a, b) => b.length - a.length);
}
export function redact(value, privateValues = []) {
  const secrets = sensitiveLeaves(privateValues);
  const visit = input => {
    if (typeof input === 'string') {for (const secret of secrets) input = input.replaceAll(secret, '[redacted]'); return input;}
    if (Array.isArray(input)) return input.map(item => item === undefined ? null : visit(item));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined).map(([key, item]) => [visit(key), visit(item)]));
    return input;
  };
  return visit(value);
}
export const countSelectors = Object.freeze({button: 'button,input[type="button"],input[type="submit"],input[type="reset"]', textbox: 'textarea,input:not([type]):not([list]),input[type="text"]:not([list]),input[type="email"]:not([list]),input[type="tel"]:not([list]),input[type="url"]:not([list])', link: 'a[href],area[href]', checkbox: 'input[type="checkbox"]'});
const stripQueries = text => text.replace(/https?:\/\/[^\s<>"']+/g, value => {try {const url = new URL(value); return `${url.origin}${url.pathname}`;} catch {return '[url]';}});
export function diagnosticDelta(kind, reply, state) {
  const text = typeof reply.result === 'string' ? reply.result : JSON.stringify(reply), lines = text.split('\n'), entries = [];
  if (kind === 'console') {
    const messages = text.match(/(?:^|\n)(?:\s*\[ERROR\][^\n]*|(?:\s*(?:Uncaught\s+)?(?:\w*Error|Exception):[^\n]*)(?:\n\s+at [^\n]*)*)/g)?.map(item => item.trim()) ?? [];
    for (const [key, selected] of [['console', messages.filter(message => /^\[ERROR\]/i.test(message))], ['exceptions', messages.filter(message => !/^\[ERROR\]/i.test(message))]]) {
      const signatures = selected.map(message => fingerprint(message)), previous = state[`${key}Signatures`] ?? [];
      if (selected.length < (state[key] ?? 0) || previous.some((value, index) => signatures[index] !== value)) state[key] = 0;
      for (const message of selected.slice(state[key] ?? 0)) entries.push({kind: 'console', detail: stripQueries(message).slice(0, 4000)});
      state[key] = selected.length; state[`${key}Signatures`] = signatures;
    }
    return {entries, clear: Number(text.match(/Total messages:\s*(\d+)/)?.[1] ?? 0) > 2000};
  }
  state.requests ??= new Set(); let maximum = 0;
  const numbers = lines.map(line => Number(line.match(/^\s*(\d+)\./)?.[1] ?? 0));
  if (Math.max(0, ...numbers) < (state.requestMaximum ?? 0)) state.requests.clear();
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+\[([A-Z]+)\]\s+(https?:\/\/\S+)\s+=>\s+\[(\d+|FAILED)\]/); if (!match) continue;
    maximum = Math.max(maximum, Number(match[1])); const signature = `${match[1]}:${match[2]}:${match[3]}:${match[4]}`;
    if (state.requests.has(signature) || match[4] !== 'FAILED' && Number(match[4]) < 400) continue;
    const url = new URL(match[3]); state.requests.add(signature); entries.push({kind: 'request', method: match[2], origin: url.origin, path: url.pathname, status: match[4] === 'FAILED' ? 'FAILED' : Number(match[4])});
  }
  state.requestMaximum = maximum; return {entries, clear: maximum > 2000};
}

/** Thin live command adapter. The agent cannot supply JavaScript or core assertion records. */
export class BrowserCommands {
  constructor({context, step, sourceScenario, references, outputs, roots, executionId, runId, usernames = {}, cancelled = () => false, privateValues = [], diagnostics = 'end', diagnosticsState = {console: 0, requests: new Set()}, lastBrowserStep = false}) {
    Object.assign(this, {context, step, sourceScenario, references, outputs, roots, executionId, runId, privateValues, diagnostics, diagnosticsState, lastBrowserStep});
    this.outputs = new Map(outputs); this.captures = new Map();
    this.usernames = usernames; this.cancelled = cancelled;
    this.ledger = new VerdictLedger(step.contracts, {verificationOnly: step.verificationOnly || step.capability === 'reads', bindings: sourceScenario.bindings});
    this.artifacts = new Map(); this.latestSnapshot = null; this.typedSubjects = new Set(); this.failure = null; this.requiredFailure = false; this.uncertainMutation = null; this.manualRetry = false; this.reconciled = null;
    context.onBeforeExpire?.(settlement => {this.settlementContext = settlement; this.interrupted = true; return this.finalize('uncertain', {interrupted: true});});
  }
  safe(value) {return redact(value, this.privateValues);}
  async native(args) {
    requireThat(!this.cancelled(), 'STOP_REQUESTED');
    args = [...args]; if (args[0] === 'back') args[0] = 'go-back'; if (args[0] === 'forward') args[0] = 'go-forward';
    const positional = validateCliGrammar(args);
    const command = args[0]; requireThat(reads.has(command) || changes.has(command) || actions.has(command), 'COMMAND_REFUSED');
    requireThat(!actions.has(command) || this.step.capability === 'mutations', 'Mutation command requires a mutation step.');
    requireThat(!this.ledger.poisoned || reads.has(command) || command.startsWith('dialog-'), 'ATTEMPT_POISONED');
    requireThat(!this.reconciled || reads.has(command), 'Reconciled attempts permit observations and settlement only.');
    requireThat(!args.some(arg => /^HARNESS_(PASSWORD|USERNAME)_/.test(arg)) || this.step.login, 'Login secret names are restricted to login steps.');
    if (command === 'type') {
      requireThat(!args.some(arg => /^HARNESS_/.test(arg)), 'Type cannot resolve login aliases. Use fill.');
      requireThat(this.latestSnapshot?.stateVersion === this.ledger.stateVersion, 'NOT_IN_SNAPSHOT');
      const focused = [...this.latestSnapshot.refs].filter(([, subject]) => subject.active);
      requireThat(focused.length === 1, 'Type needs a uniquely focused snapshot subject.');
      const focus = await this.evaluate(readTemplate('focus'), focused[0][0]);
      requireThat(focus.coverage.complete && focus.value.focused && focus.value.editable && !focus.value.passwordField, 'Type needs a focused non-password editable subject. Use fill for passwords.');
      this.typedSubjects.add(fingerprint(focused[0][1]));
    }
    if (targetCommands.has(command)) {
      this.ref(positional[0]); if (command === 'drag') this.ref(positional[1]);
      if (['fill', 'type'].includes(command)) {
        requireThat(args[1] === positional[0] && args[2] === positional[1], 'Put fill arguments before options.');
        const subject = this.latestSnapshot.refs.get(positional[0]); this.typedSubjects.add(fingerprint(subject));
        if (this.step.login && subject.name.toLowerCase().includes('password')) requireThat(/^HARNESS_PASSWORD_/.test(positional[1]), 'Login passwords must use the configured secret name.');
        if (positional[1].startsWith('HARNESS_USERNAME_')) {requireThat(Object.hasOwn(this.usernames, positional[1]), 'Unknown username alias.'); args[2] = this.usernames[positional[1]];}
      }
    }
    try {
      if (this.diagnostics === 'per-step' && ['goto', 'reload', 'go-back', 'go-forward'].includes(command)) await this.diagnosticsCapture();
      const reply = await this.callNative(args);
      if (changes.has(command) || actions.has(command)) this.ledger.changed();
      if (command.startsWith('dialog-')) this.modalPending = false;
      if (['goto', 'reload', 'go-back', 'go-forward'].includes(command)) {this.diagnosticsState.console = this.diagnosticsState.exceptions = 0; this.diagnosticsState.requests.clear();}
      return this.safe(reply);
    } catch (error) {if (error.refused) {if (error.reason === 'MODAL_PENDING') this.modalPending = true; throw error;} if (error.dispatched && (changes.has(command) || actions.has(command))) {this.ledger.changed(); this.uncertainMutation = error;} else this.requiredFailure = true; this.failure = error; this.ledger.poisoned = true; throw error;}
  }
  async callNative(args) {
    try {const reply = await this.context.native(args); this.dispatchFacts = {nativeCommand: args[0], dispatched: true, completed: true}; return reply;}
    catch (error) {this.dispatchFacts = {nativeCommand: args[0], dispatched: error.dispatched === true, completed: false}; throw error;}
  }
  ref(reference) {
    requireThat(isSnapshotRef(reference) && this.latestSnapshot?.stateVersion === this.ledger.stateVersion && this.latestSnapshot.refs.has(reference), 'NOT_IN_SNAPSHOT');
    return this.latestSnapshot.refs.get(reference);
  }
  async snapshot({retain = true} = {}) {
    this.latestSnapshot = null;
    const name = `snapshot-${randomUUID()}`, path = this.context.file(name);
    await this.native(['snapshot', `--filename=${path}`]);
    requireThat(statSync(path).size <= 240 * 1024, 'SNAPSHOT_TOO_LARGE');
    const raw = readFileSync(path, 'utf8');
    const sanitized = this.safe(raw);
    for (const line of sanitized.split('\n')) {
      // Quoted accessible names and text payloads can be redacted coverage gaps;
      // role/ref/attribute syntax cannot safely survive a native replacement.
      const structure = line.replace(/"(?:\\.|[^"\\])*"/g, '""').split(/:\s/)[0];
      const role = structure.match(/^\s*-\s+'?(\S+)/)?.[1] ?? '';
      requireThat(!/<secret>|\[redacted\]/.test(role) && !/\[[^\r\n]*(?:<secret>|\[redacted\])[^\r\n]*\]/.test(structure), 'NATIVE_SECRET_COLLISION');
    }
    let maskedIndent = null;
    const text = sanitized.split('\n').flatMap(line => {
      const indent = line.match(/^\s*/)[0].length;
      if (maskedIndent !== null && indent > maskedIndent) return [];
      maskedIndent = null;
      if (secretFindings('snapshot.txt', line).length) {maskedIndent = indent; return [`${' '.repeat(indent)}- [redacted]`];}
      return [line];
    }).join('\n');
    requireThat(Buffer.byteLength(JSON.stringify({snapshot: text})) <= 240 * 1024, 'SNAPSHOT_TOO_LARGE');
    let artifact;
    try {if (retain) artifact = await this.context.artifact('snapshot', path, () => Buffer.from(text));} finally {unlinkSync(path);}
    const record = {id: artifact, kind: 'snapshot', stateVersion: this.ledger.stateVersion, text, refs: snapshotRefs(text), incomplete: /<secret>|\[redacted\]/.test(text)};
    if (artifact) this.artifacts.set(artifact, record); this.latestSnapshot = record; return record;
  }
  async screenshot() {
    const path = this.context.file(`screenshot-${randomUUID()}`);
    // This host-owned observation is allowed after poisoning; it never establishes a new verdict.
    try {await this.callNative(['screenshot', `--filename=${path}`]);
      const artifact = await this.context.artifact('screenshot', path, bytes => {requireThat(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Invalid screenshot.'); return bytes;});
      const record = {id: artifact, kind: 'screenshot', stateVersion: this.ledger.stateVersion}; this.artifacts.set(artifact, record); return record;
    }
    catch (error) {if (error.refused && error.reason === 'MODAL_PENDING') this.modalPending = true; else {this.failure = error; this.requiredFailure = true; this.ledger.poisoned = true;} throw error;}
  }
  async evaluate(template, reference) {
    const path = this.context.file(`read-${randomUUID()}`);
    try {await this.callNative(['eval', template, ...(reference ? [reference] : []), `--filename=${path}`]);}
    catch (error) {if (error.refused && error.reason === 'MODAL_PENDING') this.modalPending = true; else {this.failure = error; this.requiredFailure = true; this.ledger.poisoned = true;} throw error;}
    requireThat(statSync(path).size <= 256 * 1024, 'Read output exceeds its bound.');
    let actual; try {actual = JSON.parse(readFileSync(path, 'utf8'));} finally {unlinkSync(path);}
    requireThat(!JSON.stringify(actual).includes('<secret>'), 'NATIVE_SECRET_COLLISION');
    requireThat(JSON.stringify(actual) === JSON.stringify(this.safe(actual)), 'Sensitive output cannot be checked or captured.');
    return actual;
  }
  async read(spec, {retain = true} = {}) {
    const parts = spec.trim().split(/\s+/), kind = parts[0];
    requireThat(['page', 'region', 'text', 'value', 'state', 'count', 'url'].includes(kind), 'Unsupported host read.');
    const snapshot = await this.snapshot({retain}); let actual, subject = {kind: 'page'};
    if (kind === 'page' || kind === 'url') actual = await this.evaluate(readTemplate(kind, null, true));
    else {
      subject = {...this.ref(parts[1])};
      if (kind === 'count') requireThat(Object.hasOwn(countSelectors, parts[2]), 'Count supports button, textbox, link and checkbox roles.');
      actual = await this.evaluate(readTemplate(kind, parts[2]), parts[1]);
    }
    requireThat(actual && typeof actual.coverage?.complete === 'boolean' && Array.isArray(actual.coverage.gaps), 'Invalid host read.');
    if (snapshot.incomplete) actual.coverage = {complete: false, gaps: [...actual.coverage.gaps, 'redacted-snapshot']};
    const read = {kind, value: actual.value, coverage: actual.coverage, subject, snapshot};
    return retain ? this.retainRead(read) : read;
  }
  async retainRead(read, polling) {
    const {kind, value, coverage, subject, snapshot} = read;
    snapshot.id ??= await this.context.evidence('snapshot', {text: snapshot.text});
    this.artifacts.set(snapshot.id, snapshot);
    const output = {readKind: kind, actual: value, coverage, subject, snapshotId: snapshot.id, ...(polling ? {polling} : {})};
    const outputId = await this.context.evidence('observation', output);
    this.artifacts.set(outputId, {id: outputId, kind: 'observation', stateVersion: this.ledger.stateVersion});
    return {kind, value, coverage, subject, evidenceIds: [snapshot.id, outputId], artifactId: outputId, digest: fingerprint(output)};
  }
  async check(key, index, options) {
    const contract = this.ledger.condition(key, index); this.ledger.timing(contract);
    const resolved = expectedValue(contract.condition, this.sourceScenario, this.references, this.outputs);
    if (resolved.missing || resolved.assumed) return this.ledger.indeterminate(key, index, 'missing-reference-data');
    if (options.source) requireThat(options.source === resolved.source, 'Expected source differs from frozen source.');
    const supplied = options.value === undefined ? resolved.value : typeof resolved.value === 'string' ? options.value : value(options.value), exact = Boolean(options.exact), wait = options.wait === undefined ? 0 : Number(options.wait);
    requireThat(Number.isInteger(wait) && wait >= 0 && wait <= 120000, 'Polling window must be 0–120000 ms.');
    const start = performance.now(), deadline = start + wait; let observation, agreementAt = null, agreeingRead, samples = 0;
    while (true) {
      requireThat(!this.cancelled(), 'STOP_REQUESTED');
      observation = await this.read(options.read, {retain: false}); samples++; requireIndependent(contract.condition, resolved, observation, this.typedSubjects);
      const passed = compareRead(contract.condition, observation, supplied, exact), matching = matchingRead(contract.condition, observation, resolved, supplied, exact);
      if (contract.condition.predicate === 'absent' && passed && matching) {
        if (agreementAt === null) {agreementAt = performance.now(); agreeingRead = observation;}
        if (performance.now() - agreementAt >= 1000) break;
        await delay(1000); continue;
      }
      agreementAt = null; agreeingRead = null;
      if (passed || performance.now() >= deadline) break; await delay(Math.min(250, Math.max(1, deadline - performance.now())));
    }
    const agreement = agreeingRead ? await this.retainRead(agreeingRead) : null;
    observation = await this.retainRead(observation, {samples, elapsedMs: Math.round(performance.now() - start), agreeingAbsence: Boolean(agreement)});
    if (agreement) observation.evidenceIds.unshift(...agreement.evidenceIds);
    return this.ledger.checked(key, index, {read: observation, resolved, supplied, exact, evidenceIds: observation.evidenceIds, typedSubjects: this.typedSubjects});
  }
  async diagnosticsCapture() {
    const facts = [];
    for (const args of [['console', 'error'], ['requests']]) {
      try {
        const result = await this.context.diagnostic(args);
        if (result.notice) {facts.push({kind: args[0], notice: result.reason}); continue;}
        const delta = diagnosticDelta(args[0], this.safe(result.reply), this.diagnosticsState); facts.push(...delta.entries);
        if (delta.clear) {const cleared = await this.context.diagnostic([args[0], '--clear']); if (!cleared.notice) {if (args[0] === 'console') this.diagnosticsState.console = this.diagnosticsState.exceptions = 0; else this.diagnosticsState.requests.clear();}}
      } catch (error) {this.failure = error; this.ledger.poisoned = true; throw error;}
    }
    const artifactId = await this.context.evidence('observation', {diagnostics: facts, partOfVerdict: false});
    this.artifacts.set(artifactId, {id: artifactId, kind: 'observation', stateVersion: this.ledger.stateVersion}); return facts;
  }
  async finalize(effect, {interrupted = false} = {}) {
    if (this.finalized) return this.finalized;
    if (interrupted) this.interrupted = true;
    if (this.finalizing) return this.finalizing;
    this.finalizing = this.settle(effect).then(result => {this.finalized = result; return result;}).finally(() => {this.finalizing = null;});
    return this.finalizing;
  }
  async settle(effect) {
    requireThat(effect !== 'not-executed' || !this.ledger.firstActionVersion && !this.captures.size && !this.ledger.results.some(item => ['PASS', 'FAIL'].includes(item.status)), 'not-executed cannot contain dispatched actions, outputs or evaluated assertions.');
    if (this.reconciled) {
      const allowed = {'confirmed-effect': ['confirmed', 'uncertain'], 'confirmed-no-effect': ['none', 'uncertain'], inconclusive: ['uncertain']}[this.reconciled.kind];
      requireThat(effect === undefined || allowed.includes(effect), 'Effect contradicts the accepted reconciliation.');
    }
    const context = () => this.settlementContext ?? this.context;
    const bound = artifactId => this.artifacts.has(artifactId);
    let results = this.ledger.aggregate({artifactValid: bound});
    if (!this.interrupted && !this.modalPending && results.some(result => ['FAIL', 'INDETERMINATE'].includes(result.status))) try {await this.screenshot();} catch { /* screenshot records required failures; modal refusals retain existing verdicts. */ }
    if (!this.interrupted && !this.modalPending && (this.diagnostics === 'per-step' || this.diagnostics === 'end' && (this.lastBrowserStep || results.some(result => ['FAIL', 'INDETERMINATE'].includes(result.status))))) try {await this.diagnosticsCapture();} catch { /* Preserve the underlying execution failure and historical assertions. */ }
    results = this.ledger.aggregate({artifactValid: bound});
    for (const result of results) {
      const assertionId = await context().evidence('assertion', assertionEvidence(result));
      result.evidenceIds.push(assertionId); this.artifacts.set(assertionId, {id: assertionId, kind: 'assertion', stateVersion: this.ledger.stateVersion});
      const required = this.step.contracts.find(contract => contract.id === result.id)?.synthetic ? ['assertion'] : ['assertion', 'snapshot'];
      if (['PASS', 'FAIL'].includes(result.status) && !required.every(kind => result.evidenceIds.some(id => this.artifacts.get(id)?.kind === kind))) {result.status = 'INDETERMINATE'; result.reliable = false; result.reason = 'insufficient-evidence';}
    }
    try {context().verifyEvidence();}
    catch (cause) {throw Object.assign(new Error('EVIDENCE_INTEGRITY_FAILURE', {cause}), {code: 'EVIDENCE_INTEGRITY_FAILURE'});}
    const created = this.step.creates?.[0], resources = [], lifecycles = [];
    const confirmed = !this.ledger.poisoned && (effect === 'confirmed' || this.reconciled?.kind === 'confirmed-effect');
    if (created && confirmed && this.captures.has(created.identityOutput)) {
      const output = this.captures.get(created.identityOutput), action = created.intent === 'temporary' ? 'cleanup' : created.intent === 'persistent' ? 'retain' : 'none';
      resources.push({id: created.resource, identity: {attemptId: this.context.identity.attemptId, name: output.producer.name}, ownership: 'harness', intent: created.intent, lifecycle: {action, status: action === 'cleanup' ? 'pending' : 'not-required', evidenceIds: []}});
    }
    if (this.step.cleanupResource) {
      const complete = !this.interrupted && !this.failure && !this.ledger.poisoned && results.every(item => item.status === 'PASS') && effect === 'confirmed';
      const evidenceIds = [...new Set(results.flatMap(item => item.evidenceIds))], lifecycleId = await context().evidence('lifecycle', {resourceId: this.step.cleanupResource, complete, verificationArtifacts: evidenceIds});
      lifecycles.push({resourceId: this.step.cleanupResource, update: {status: complete ? 'completed' : 'failed', evidenceIds: [lifecycleId, ...evidenceIds]}});
    }
    const resourceIds = [...resources.map(item => item.id), ...(this.step.cleanupResource && (effect === 'confirmed' || this.interrupted) ? [this.step.cleanupResource] : [])];
    const uncertain = this.reconciled || this.step.capability === 'mutations' && (this.ledger.poisoned || this.interrupted || created && !resources.length);
    const certainty = uncertain ? 'uncertain' : effect ?? (this.step.capability === 'reads' ? 'none' : 'uncertain');
    context().commit({assertions: results.map(({id, status, reliable, evidenceIds}) => ({id, status, reliable, evidenceIds})),
      outputs: [...this.captures.values()].map(({family, subject, ...output}) => output), resources, lifecycles, effect: {certainty, resourceIds},
      ...(this.reconciled ? {reconciliation: this.reconciled} : {}), retry: this.manualRetry});
    return {status: 'STEP_ENDING', conditions: results.map(({id, status, method}) => ({id, status, method})), expectations: aggregateSourceConditions(results)};
  }
  async dispatch(args) {
    const [command, ...rest] = args;
    if (command === 'native') {requireThat(rest[0] !== 'snapshot', 'COMMAND_REFUSED: use look for a registered snapshot.'); return {status: 'OK', reply: await this.native(rest)};}
    if (command === 'look') {const snapshot = await this.snapshot(); return {status: 'OK', snapshot: snapshot.text, evidenceId: snapshot.id, stateVersion: snapshot.stateVersion};}
    const {positional, options} = parseOptions(rest), key = positional[0], index = Number(options.condition ?? 1);
    if (command === 'check') {requireThat(options.read, 'Check needs --read.'); return {status: 'OK', result: await this.check(key, index, options)};}
    if (command === 'observe') {
      const ids = String(options.evidence ?? '').split(',').filter(Boolean), artifacts = ids.map(id => this.artifacts.get(id)); requireThat(artifacts.every(Boolean), 'Unknown observation artifact.');
      return {status: 'OK', result: this.ledger.observed(key, index, {status: positional[1], observed: options.observed, rationale: options.rationale, actual: options.actual, whyNotChecked: options['why-not-checked'], artifacts})};
    }
    if (command === 'indeterminate') {const result = this.ledger.indeterminate(key, index, options.reason); if (this.reconciled) this.manualRetry = false; return {status: 'OK', result};}
    if (command === 'invalidate') return {status: 'OK', result: this.ledger.invalidate(Number(key), options.reason)};
    if (command === 'evidence') {const artifact = key === 'snapshot' ? await this.snapshot() : key === 'screenshot' ? await this.screenshot() : null; requireThat(artifact, 'Evidence kind must be snapshot or screenshot.'); return {status: 'OK', evidenceId: artifact.id};}
    if (command === 'note') {const artifactId = await this.context.evidence('observation', {note: positional.join(' ')}); this.artifacts.set(artifactId, {id: artifactId, kind: 'observation', stateVersion: this.ledger.stateVersion}); return {status: 'OK', evidenceId: artifactId};}
    if (command === 'capture') {
      id(key); requireThat(!this.outputs.has(key) && options.read, 'Capture needs a new output name and a host read.');
      const read = await this.read(options.read), captured = {name: key, type: read.value === null ? 'null' : Array.isArray(read.value) ? 'array' : typeof read.value, sensitivity: 'public', value: read.value,
        producer: {runId: this.context.identity.runId, scenarioId: this.context.identity.scenarioId, attemptId: this.context.identity.attemptId, name: key}};
      this.captures.set(key, {...captured, family: 'browser', subject: read.subject}); this.outputs.set(key, this.captures.get(key)); return {status: 'OK', output: captured};
    }
    if (command === 'reconcile') {
      requireThat(['no-effect', 'effect', 'inconclusive'].includes(key), 'Invalid reconciliation.');
      requireThat(this.step.capability === 'mutations' && this.uncertainMutation?.dispatched, 'Reconciliation requires an uncertain dispatched mutation.');
      if (key === 'effect' && this.step.creates?.[0]) requireThat(this.outputs.has(this.step.creates[0].identityOutput), 'Capture the created resource identity before confirming its effect.');
      const ids = String(options.evidence ?? '').split(',').filter(Boolean); requireThat(ids.length && ids.every(id => this.artifacts.has(id) && this.artifacts.get(id).stateVersion === this.ledger.stateVersion), 'Reconciliation needs fresh registered evidence.');
      const kind = key === 'no-effect' ? 'confirmed-no-effect' : key === 'effect' ? 'confirmed-effect' : 'inconclusive';
      if (this.reconciled) {requireThat(this.reconciled.kind === kind && fingerprint(ids) === this.reconciliationInputs, 'Reconciliation is immutable; mark incorrect reconciliation indeterminate and start a new execution.'); return {status: 'OK', kind};}
      const artifactId = await this.context.evidence('reconciliation', {kind, supportingIds: ids});
      this.reconciled = {kind, evidenceIds: [artifactId]}; this.reconciliationInputs = fingerprint(ids);
      if (kind === 'confirmed-no-effect') this.manualRetry = true;
      else if (kind === 'confirmed-effect') this.ledger.poisoned = this.requiredFailure;
      return {status: 'OK', kind};
    }
    if (command === 'save-login') {
      requireThat(this.step.login && this.step.login.landmark && this.latestSnapshot && normalize(this.latestSnapshot.text).includes(normalize(this.step.login.landmark)), 'Login landmark has not been observed.');
      const path = this.context.file(`login-${randomUUID()}`);
      const directory = ownedFile(this.roots, this.executionId, 'auth'); mkdirSync(directory, {recursive: true, mode: 0o700}); protect(directory); const saved = ownedFile(this.roots, this.executionId, `auth/${this.step.target}-${this.step.login.user}.json`);
      try {await this.callNative(['state-save', path]); requireThat(statSync(path).size <= 2 * 1024 * 1024, 'Login state exceeds its bound.'); copyFileSync(path, saved); chmodSync(saved, 0o600);}
      catch (error) {if (error.refused && error.reason === 'MODAL_PENDING') this.modalPending = true; else {this.failure = error; this.requiredFailure = true; this.ledger.poisoned = true;} throw error;}
      return {status: 'LOGIN_SAVED', target: this.step.target, user: this.step.login.user};
    }
    throw new Error('Unknown execution command.');
  }
}
