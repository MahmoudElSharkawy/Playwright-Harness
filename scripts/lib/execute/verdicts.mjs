import {isDeepStrictEqual} from 'node:util';
import {data, requireThat, fingerprint} from '../execution-core/data.mjs';
import {normalize, subjectDetails} from './refinement.mjs';

export function matchesSubject(frozen, observed) {
  const subject = subjectDetails(frozen);
  return subject.kind === 'page' ? observed?.kind === 'page' : observed && subject.kind === observed.kind
    && (!subject.role || subject.role === observed.role) && normalize(observed.name).includes(normalize(subject.name));
}
export function matchingRead(condition, read, resolved, supplied = resolved.value, exact = false) {
  const compatible = {present: ['page', 'region', 'text'], absent: ['page', 'region', 'text'], equals: ['text', 'value'], url: ['url'], count: ['count']};
  const allowed = condition.predicate.startsWith('state:') ? read.kind === 'state' : compatible[condition.predicate]?.includes(read.kind);
  const same = exact ? isDeepStrictEqual(supplied, resolved.value) : normalize(supplied) === normalize(resolved.value);
  return Boolean(allowed && matchesSubject(condition.subject, read.subject) && same && (!condition.exact || exact));
}
export function compareRead(condition, read, expected, exact = false) {
  const predicate = condition.predicate, actual = read.value;
  if (predicate === 'count') {requireThat(typeof expected === 'number' && Number.isFinite(expected), 'VACUOUS_CHECK'); return actual === expected;}
  if (predicate.startsWith('state:')) return actual?.[predicate.slice(6)] === true;
  const normalizeValue = value => exact ? String(value) : normalize(value);
  if (predicate === 'present' || predicate === 'absent') {
    requireThat(String(expected).trim().length > 0 && (read.kind !== 'page' || String(expected).replace(/\s/g, '').length >= 3), 'VACUOUS_CHECK');
    const present = normalizeValue(actual).includes(normalizeValue(expected)); return predicate === 'present' ? present : !present;
  }
  return typeof actual === 'string' || typeof expected === 'string' ? normalizeValue(actual) === normalizeValue(expected) : isDeepStrictEqual(actual, expected);
}
export function requireIndependent(condition, resolved, read, typedSubjects = new Set()) {
  if (typedSubjects.has(fingerprint(read.subject))) throw new Error('SELF_COMPARISON');
  if (condition.expected?.source.startsWith('output:')) {
    requireThat(!resolved.missing && (resolved.family !== 'browser' || !resolved.subject || fingerprint(resolved.subject) !== fingerprint(read.subject)), 'SELF_COMPARISON');
  }
}
export function mandatoryLiterals(condition, bindings = {}) {
  const text = condition.text, literals = [...text.matchAll(/["“]([^"”]+)["”]|'([^']+)'/g)].map(match => match[1] ?? match[2]);
  literals.push(...(text.match(/\b\d+(?:\.\d+)?\b/g) ?? []));
  for (const value of Object.values(bindings)) if (String(value).trim() && text.includes(String(value))) literals.push(String(value));
  return [...new Set(literals)];
}

/** Attempt-local ledger. Supporting comparisons are provenance, never verdicts. */
export class VerdictLedger {
  constructor(contracts, {verificationOnly = false, bindings = {}} = {}) {
    this.contracts = contracts; this.verificationOnly = verificationOnly; this.bindings = bindings;
    this.results = []; this.stateVersion = 0; this.firstActionVersion = null; this.poisoned = false;
  }
  changed() {this.stateVersion++; this.firstActionVersion ??= this.stateVersion;}
  condition(key, index) {
    const contract = this.contracts.find(item => item.key === key && item.index === index);
    requireThat(contract, 'Unknown frozen condition.'); return contract;
  }
  timing(contract) {
    requireThat(!this.poisoned, 'ATTEMPT_POISONED');
    if (this.verificationOnly) return;
    if (contract.condition.precondition) requireThat(this.firstActionVersion === null, 'PRECONDITION_TOO_LATE');
    else requireThat(this.firstActionVersion !== null, 'PREMATURE_CHECK');
  }
  add(contract, value) {
    const result = data({seq: this.results.length + 1, conditionId: contract.id, stateVersion: this.stateVersion, invalidated: false, ...value}, 64 * 1024);
    this.results.push(result); return result;
  }
  checked(key, index, {read, resolved, supplied = resolved.value, exact = false, evidenceIds, typedSubjects} = {}) {
    const contract = this.condition(key, index); this.timing(contract);
    requireIndependent(contract.condition, resolved, read, typedSubjects);
    const matching = matchingRead(contract.condition, read, resolved, supplied, exact), passed = compareRead(contract.condition, read, supplied, exact);
    requireThat(Array.isArray(evidenceIds) && evidenceIds.length > 0, 'A check needs registered observation evidence.');
    return this.add(contract, {method: 'checked', matching, status: passed ? 'PASS' : 'FAIL', read, expected: resolved, supplied, exact, evidenceIds});
  }
  observed(key, index, {status, observed, rationale, actual, whyNotChecked, artifacts} = {}) {
    const contract = this.condition(key, index); this.timing(contract);
    requireThat(['PASS', 'FAIL'].includes(status) && typeof observed === 'string' && observed.trim() && typeof rationale === 'string' && rationale.trim(), 'Observation needs a verdict, facts and rationale.');
    requireThat(['no-traceable-value', 'visual-only', 'not-readable', 'composite'].includes(whyNotChecked), 'Observation needs why-not-checked.');
    requireThat(status !== 'FAIL' || actual !== undefined, 'Observed FAIL needs actual behavior.');
    requireThat(Array.isArray(artifacts) && artifacts.length && artifacts.every(item => ['snapshot', 'screenshot'].includes(item.kind) && (contract.condition.precondition && !this.verificationOnly ? this.firstActionVersion === null : item.stateVersion === this.stateVersion)), 'Observation must cite artifacts from its observed state.');
    const literals = mandatoryLiterals(contract.condition, this.bindings);
    requireThat(literals.every(literal => normalize(observed).includes(normalize(literal))), 'Observation must name the condition literals.');
    const snapshotText = artifacts.filter(item => item.kind === 'snapshot').map(item => item.text ?? '').join('\n');
    if (status === 'PASS' && literals.some(literal => !normalize(snapshotText).includes(normalize(literal)))) requireThat(artifacts.some(item => item.kind === 'screenshot'), 'Visual PASS needs a screenshot.');
    return this.add(contract, {method: 'observed', matching: true, status, observed, rationale, ...(actual === undefined ? {} : {actual}), whyNotChecked, evidenceIds: artifacts.map(item => item.id)});
  }
  indeterminate(key, index, reason) {
    const contract = this.condition(key, index); this.timing(contract);
    requireThat(['ambiguous-expected', 'missing-reference-data', 'insufficient-evidence', 'blocked-by-defect'].includes(reason), 'Unknown indeterminate reason.');
    return this.add(contract, {method: 'unresolved', matching: true, status: 'INDETERMINATE', reason, evidenceIds: []});
  }
  invalidate(seq, reason) {
    requireThat(['wrong-target', 'misread-condition', 'premature-evidence'].includes(reason), 'Invalid invalidation reason.');
    const result = this.results.find(item => item.seq === seq);
    requireThat(result?.status === 'FAIL' && result.matching && !result.invalidated, 'Only a finalized FAIL may be invalidated.');
    result.invalidated = true; result.invalidationReason = reason; return result;
  }
  aggregate({skipped = false, artifactValid = () => true} = {}) {
    return this.contracts.map(contract => {
      const all = this.results.filter(item => item.conditionId === contract.id), valid = all.filter(item => !item.invalidated && item.matching && item.evidenceIds.every(artifactValid)
        && (item.status === 'FAIL' || contract.condition.precondition || item.stateVersion === this.stateVersion));
      const checkedFail = valid.find(item => item.method === 'checked' && item.status === 'FAIL'), checkedPass = valid.find(item => item.method === 'checked' && item.status === 'PASS');
      const observedFail = valid.find(item => item.method === 'observed' && item.status === 'FAIL'), observedPass = valid.find(item => item.method === 'observed' && item.status === 'PASS');
      let status, reason;
      if (contract.synthetic || contract.condition.ambiguous || skipped) {status = 'INDETERMINATE'; reason = 'ambiguous-expected';}
      else if (all.some(item => item.invalidated && item.status === 'FAIL')) {status = 'INDETERMINATE'; reason = 'invalidated';}
      else if (checkedFail) status = 'FAIL';
      else if (checkedPass && observedFail) {status = 'INDETERMINATE'; reason = 'contradiction';}
      else if (observedFail) status = 'FAIL';
      else if (valid.some(item => item.status === 'INDETERMINATE')) {status = 'INDETERMINATE'; reason = valid.find(item => item.status === 'INDETERMINATE').reason;}
      else if (checkedPass || observedPass) status = 'PASS';
      else {status = 'INDETERMINATE'; reason = 'unresolved';}
      if (this.poisoned && !(status === 'FAIL' || contract.condition.precondition && ['PASS', 'FAIL'].includes(status))) status = 'NOT_EVALUATED';
      const kinds = new Set(valid.filter(item => item.status === status).map(item => item.method));
      return {id: contract.id, key: contract.key, index: contract.index, status, reliable: ['PASS', 'FAIL'].includes(status), method: kinds.size > 1 ? 'mixed' : [...kinds][0] ?? 'unresolved',
        ...(reason ? {reason} : {}), evidenceIds: [...new Set(valid.flatMap(item => item.evidenceIds))], provenance: {version: 1, contract, results: all, finalStateVersion: this.stateVersion}};
    });
  }
}
export function aggregateSourceConditions(conditions) {
  const groups = new Map();
  for (const condition of conditions) {const group = groups.get(condition.key) ?? []; group.push(condition); groups.set(condition.key, group);}
  return [...groups].map(([key, results]) => ({key, status: results.some(item => item.status === 'FAIL') ? 'FAIL' : results.every(item => item.status === 'PASS') ? 'PASS' : 'INDETERMINATE',
    method: new Set(results.map(item => item.method)).size > 1 ? 'mixed' : results[0].method, conditions: results}));
}
