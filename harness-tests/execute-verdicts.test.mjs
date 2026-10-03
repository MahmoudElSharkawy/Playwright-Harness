import test from 'node:test';
import assert from 'node:assert/strict';
import {VerdictLedger, compareRead, requireIndependent} from '../scripts/lib/execute/verdicts.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
const condition = {text: 'Save button is disabled', predicate: 'state:disabled', subject: {element: {role: 'button', name: 'Save'}}, expected: null, precondition: false, exact: false, ambiguous: false};
const ledger = (patch = {}) => new VerdictLedger([{id: 'c1', key: 'k1', index: 1, condition: {...condition, ...patch}, synthetic: false}], {verificationOnly: true});
const checked = (l, disabled = true, subject = {kind: 'element', role: 'button', name: 'Save'}) => l.checked('k1', 1, {read: {kind: 'state', subject, value: {disabled}}, resolved: {value: null, source: 'none'}, evidenceIds: ['a1']});
test('supporting comparisons never decide a condition and finalized checked FAIL survives changes', () => {
  const l = ledger(); l.checked('k1', 1, {read: {kind: 'page', subject: {kind: 'page'}, value: 'Save'}, resolved: {value: null}, evidenceIds: ['a1']}); assert.equal(l.aggregate()[0].status, 'INDETERMINATE');
  checked(l); assert.equal(l.aggregate()[0].status, 'PASS'); checked(l, false); l.changed(); checked(l); assert.equal(l.aggregate()[0].status, 'FAIL');
});
test('invalidated FAIL caps later PASS; checked PASS plus grounded observed FAIL conflicts', () => {
  const l = ledger(); const failed = checked(l, false); l.invalidate(failed.seq, 'wrong-target'); checked(l); assert.equal(l.aggregate()[0].status, 'INDETERMINATE');
  const other = ledger(); checked(other); other.observed('k1', 1, {status: 'FAIL', observed: 'Save is enabled', rationale: 'The control is enabled', actual: 'Enabled', whyNotChecked: 'visual-only', artifacts: [{id: 'snap', kind: 'snapshot', stateVersion: 0, text: 'button Save'}]}); assert.equal(other.aggregate()[0].reason, 'contradiction');
});
test('vacuity, timing and direct self comparisons are refused', () => {
  assert.throws(() => compareRead({...condition, predicate: 'present'}, {kind: 'page', value: 'Save'}, ''), /VACUOUS/); assert(compareRead({...condition, predicate: 'equals'}, {kind: 'value', value: ''}, ''));
  const subject = {kind: 'element', role: 'textbox', name: 'Name'}, read = {kind: 'value', subject, value: 'A'};
  assert.throws(() => requireIndependent({...condition, expected: {source: 'output:o'}}, {value: 'A', family: 'browser', subject}, read), /SELF_COMPARISON/);
  assert.throws(() => requireIndependent(condition, {value: null}, read, new Set([fingerprint(subject)])), /SELF_COMPARISON/);
  const l = new VerdictLedger([{id: 'c1', key: 'k1', index: 1, condition, synthetic: false}]); assert.throws(() => checked(l), /PREMATURE/);
  const pre = new VerdictLedger([{id: 'c1', key: 'k1', index: 1, condition: {...condition, precondition: true}, synthetic: false}]); checked(pre); pre.changed(); assert.equal(pre.aggregate()[0].status, 'PASS');
});
test('poisoning preserves historical FAIL and never invents a pass from literals', () => {
  const l = ledger(); checked(l, false); l.poisoned = true; assert.equal(l.aggregate()[0].status, 'FAIL'); assert.throws(() => checked(l), /POISONED/);
  const empty = ledger(); assert.equal(empty.aggregate()[0].status, 'INDETERMINATE');
});
