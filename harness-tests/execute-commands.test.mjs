import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture} from './fixtures/execute.mjs';
import {commandFixture} from './fixtures/execute-commands.mjs';
import {redact} from '../scripts/lib/execute/commands.mjs';
import {unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture as coreFixture, scope} from './fixtures/execution-core.mjs';
import {ASSERTION_BYTES} from '../scripts/lib/execute/verdicts.mjs';
test('element check binds its own snapshot and read output; asynchronous changes do not replace observed evidence', async t => {
  const fixture = await executionFixture(t), f = commandFixture(fixture.projectRoot); const reply = await f.commands.dispatch(['check', 'k1', '--read', 'state e1']);
  assert.equal(reply.result.evidenceIds.length, 2); assert.deepEqual(reply.result.evidenceIds.map(id => f.evidence.get(id).kind), ['snapshot', 'observation']); f.disabled(false); await f.commands.finalize('none'); assert.equal(f.assertions[0].status, 'PASS');
  assert.equal(f.calls.at(-1)[0], 'effect'); assert.equal(f.evidence.get(reply.result.evidenceIds[1]).value.actual.disabled, true);
});
test('navigation rejects old refs, stales PASS and preserves historical FAIL', async t => {
  const fixture = await executionFixture(t), f = commandFixture(fixture.projectRoot); await f.commands.dispatch(['look']); await f.commands.dispatch(['native', 'goto', 'http://localhost']); await assert.rejects(f.commands.dispatch(['native', 'click', 'e1']), /NOT_IN_SNAPSHOT/);
  await f.commands.dispatch(['check', 'k1', '--read', 'state e1']); await f.commands.dispatch(['native', 'hover', 'e1']); assert.equal(f.commands.ledger.aggregate()[0].status, 'INDETERMINATE');
  f.disabled(false); await f.commands.dispatch(['check', 'k1', '--read', 'state e1']); await f.commands.dispatch(['native', 'reload']); assert.equal(f.commands.ledger.aggregate()[0].status, 'FAIL');
});
test('dead reference poisons an attempt while end-step retains an earlier FAIL', async t => {
  const fixture = await executionFixture(t), f = commandFixture(fixture.projectRoot, {disabled: false}); await f.commands.dispatch(['check', 'k1', '--read', 'state e1']); f.fail(); await assert.rejects(f.commands.dispatch(['native', 'click', 'e1']), /EXECUTOR/); await assert.rejects(f.commands.dispatch(['check', 'k1', '--read', 'state e1']), /POISONED/); await f.commands.finalize('uncertain'); assert.equal(f.assertions[0].status, 'FAIL');
});
test('capture and same-step typed field cannot become their own oracle, including after hover', async t => {
  const fixture = await executionFixture(t), f = commandFixture(fixture.projectRoot, {predicate: 'equals', expected: {source: 'output:captured'}}); await f.commands.dispatch(['capture', 'captured', '--read', 'value e2']); await f.commands.dispatch(['native', 'hover', 'e2']); await assert.rejects(f.commands.dispatch(['check', 'k1', '--read', 'value e2']), /SELF_COMPARISON/);
  f.step.contracts[0].condition.expected = {source: 'source-text', value: 'A'}; await f.commands.dispatch(['native', 'fill', 'e2', 'A']); await assert.rejects(f.commands.dispatch(['check', 'k1', '--read', 'value e2']), /SELF_COMPARISON/);
});
test('non-login secret names and mutations in reads are refused before dispatch', async t => {
  const fixture = await executionFixture(t), f = commandFixture(fixture.projectRoot); await f.commands.dispatch(['look']); f.step.capability = 'reads'; await assert.rejects(f.commands.dispatch(['native', 'click', 'e1']), /mutation step/); f.step.capability = 'mutations'; await assert.rejects(f.commands.dispatch(['native', 'fill', 'e2', 'HARNESS_PASSWORD_USER']), /login steps/); assert.equal(f.calls.filter(call => call[1] === 'fill').length, 0);
});

test('escaped login values are redacted before JSON encoding in nested replies', () => {
  for (const input of ['quote"secret', 'back\\slash', 'line\nsecret']) {
    assert.deepEqual(redact({detail: input, nested: [input, {encoded: encodeURIComponent(input)}], [input]: input}, [input]), {detail: '[redacted]', nested: ['[redacted]', {encoded: '[redacted]'}], '[redacted]': '[redacted]'});
  }
});

for (const corrupt of ['missing', 'changed']) test(`end-step rejects ${corrupt} registered evidence before committing assertions or effects`, async t => {
  const core = coreFixture(t), f = commandFixture(core.roots.projectRoot, {core});
  const reply = await f.commands.dispatch(['check', 'k1', '--read', 'state e1']);
  const record = core.report.evidence.find(item => item.id === reply.result.evidenceIds[0]), file = join(core.roots.runRoot, record.path);
  if (corrupt === 'missing') unlinkSync(file); else writeFileSync(file, 'Changed snapshot');
  await assert.rejects(f.commands.finalize('confirmed'), {code: 'EVIDENCE_INTEGRITY_FAILURE'});
  assert.equal(f.assertions.length, 0); assert(!f.calls.some(([name]) => ['effect', 'resource', 'lifecycle'].includes(name)));
});

test('repeated large checks stop at the provenance budget and retain an assessed historical FAIL', async t => {
  const core = coreFixture(t, {scenarios: scope(['snapshot', 'assertion'])}), f = commandFixture(core.roots.projectRoot, {core, predicate: 'equals', expected: {source: 'source-text', value: 'A'}, text: 'x'.repeat(8000)});
  f.step.contracts[0].id = 'visible'; let count = 0;
  while (!f.commands.ledger.finishRequired && count < 10) {await f.commands.dispatch(['check', 'k1', '--read', 'text e2']); count++;}
  assert(count < 10); assert(f.commands.ledger.finishRequired); assert.equal(f.commands.ledger.aggregate()[0].status, 'FAIL');
  await assert.rejects(f.commands.dispatch(['check', 'k1', '--read', 'text e2']), /OBSERVATION_LIMIT/);
  await f.commands.finalize('none');
  const assertion = [...f.evidence.values()].find(item => item.kind === 'assertion').value;
  assert(Buffer.byteLength(JSON.stringify(assertion)) <= ASSERTION_BYTES); assert.equal(assertion.results.length, count);
  core.current.assertions = f.assertions; core.current.outcome = 'ASSERTION_FAILURE'; core.current.failureClass = 'ASSERTION'; assert.equal(core.assess().status, 'FAIL');
});

test('a single oversized read cannot hide a failed comparison behind an earlier PASS', async t => {
  const core = coreFixture(t), f = commandFixture(core.roots.projectRoot, {core, predicate: 'equals', expected: {source: 'source-text', value: 'A'}, text: 'A'});
  await f.commands.dispatch(['check', 'k1', '--read', 'text e2']); f.text('x'.repeat(100000));
  const reply = await f.commands.dispatch(['check', 'k1', '--read', 'text e2']); assert(reply.result.budgetExceeded); assert.equal(f.commands.ledger.aggregate()[0].status, 'INDETERMINATE');
  await f.commands.finalize('none'); assert.equal(f.assertions[0].status, 'INDETERMINATE');
  assert(Buffer.byteLength(JSON.stringify([...f.evidence.values()].find(item => item.kind === 'assertion').value)) <= ASSERTION_BYTES);
});
