import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {executeHostCases, hostCaseIds} from './fixtures/host-execution.mjs';
import {executionSemantics, compareExecutions} from '../scripts/lib/host-parity.mjs';
import {createRun, assessRun} from '../scripts/lib/execution-core/index.mjs';

test('real API lifecycle cases compare semantic results across separate executions', async t => {
  const roots = [mkdtempSync(join(tmpdir(), 'harness-m11-a-')), mkdtempSync(join(tmpdir(), 'harness-m11-b-'))];
  t.after(() => roots.forEach(root => rmSync(root, {recursive: true, force: true})));
  const ids = hostCaseIds.filter(id => !/^(sqlserver|postgresql|browser|mixed)/.test(id));
  const a = await executeHostCases(roots[0], {}, {only: ids}), b = await executeHostCases(roots[1], {}, {only: ids});
  assert.notEqual(a[0].run.id, b[0].run.id);
  const comparison = compareExecutions(a, b, ids); assert.equal(comparison.status, 'PASS');
  assert(comparison.cases.every(c => Number.isSafeInteger(c.assertions) && c.assertions > 0));
  for (const id of ids) await t.test(id, () => assert.deepEqual(executionSemantics(a.find(c => c.id === id)), executionSemantics(b.find(c => c.id === id))));
  await t.test('empty, missing, duplicate and reordered scope fails closed', () => {
    for (const [left, right, expected] of [[[], [], []], [a.slice(1), b, ids], [[a[0], ...a.slice(0, -1)], b, ids], [[...a].reverse(), b, ids]]) assert.throws(() => compareExecutions(left, right, expected), /scope|cases/);
  });
  await t.test('changed verdicts and foreign attempts cannot be normalized away', () => {
    const bad = structuredClone(a[0]); bad.result.status = 'FAIL'; assert.throws(() => executionSemantics(bad), /verdict/);
    const foreign = structuredClone(a[0]); foreign.observations.scenarios[0].attempts[0].identity.runId = 'foreign'; assert.throws(() => executionSemantics(foreign), /execution/);
  });
  await t.test('generated IDs differ only through reviewed producer correspondences', () => {
    const missing = structuredClone(b[0]); missing.symbols = [];
    assert.notDeepEqual(executionSemantics(a[0]), executionSemantics(missing));
    const wrong = structuredClone(b[0]); wrong.symbols[0].slots.push({scenarioId: 'case', name: 'label'});
    assert.throws(() => executionSemantics(wrong), /correspondence/);
  });
  await t.test('recovered reads keep the successful producer attempt number', () => {
    const semantics = executionSemantics(a.find(c => c.id === 'safe-read-recovery'));
    assert.equal(semantics.scenarios[0].outputs[0].producer.attempt[2], 2);
    assert.equal(semantics.scenarios[0].attempts.length, 2);
  });
  await t.test('a valid changed business output remains a semantic difference', () => {
    const changed = structuredClone(b[0]);
    changed.observations.scenarios[0].attempts.find(a => a.identity.operationId === 'verify').outputs[0].value = 'business-difference';
    const run = createRun({id: changed.run.id, startedAt: changed.run.startedAt, ...changed.run.inputs});
    changed.result = assessRun(run, changed.roots, changed.observations);
    assert.notDeepEqual(executionSemantics(a[0]), executionSemantics(changed));
  });
  await t.test('artifact tampering fails before cross-host equality is considered', () => {
    const c = a[0], file = join(c.roots.runRoot, c.result.evidence[0].path), before = readFileSync(file);
    try {writeFileSync(file, 'tampered'); assert.throws(() => executionSemantics(c), /integrity|size|changed/i);} finally {writeFileSync(file, before);}
  });
});
