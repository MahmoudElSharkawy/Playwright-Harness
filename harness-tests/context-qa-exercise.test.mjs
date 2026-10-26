import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';

function exercise(t) {
  const {roots} = fixture(t), directory = join(roots.projectRoot, 'exercise');
  const command = (...args) => spawnSync(process.execPath, [join(roots.packageRoot, 'scripts/probes/context-qa.mjs'), args[0], directory, ...args.slice(1)], {encoding: 'utf8', windowsHide: true});
  const result = command('prepare', roots.packageRoot, 'sections');
  assert.equal(result.status, 0, result.stderr);
  return {directory, command, state: JSON.parse(readFileSync(join(directory, 'exercise.json'), 'utf8'))};
}

test('section exercise freezes equal inputs and budgets and defers the explicit upgrade', t => {
  const {state} = exercise(t);
  assert.equal(state.profile, 'sections'); assert.equal(state.prompts.length, 8);
  assert.deepEqual(state.corpusHashes.before, state.corpusHashes.after);
  assert.equal(state.measurements.after.upgradedRevision, undefined);
  assert.deepEqual(state.budgets.map(value => value.calls), [6, 6, 0, 6, 6, 6, 3, 6]);
  assert(state.budgets.every(value => value.maxBytes === 4096));
  assert(state.runtimeHashes.before['scripts/lib/context/documents.mjs']);
  assert.equal(state.modelUsage.tokens, null);
});

test('exercise budgets apply equally, count failed retrievals and prohibit formatting retrieval', t => {
  const {directory, command} = exercise(t);
  for (const arm of ['before', 'after']) {
    const failed = command('query', arm, '7', 'search', 'refunds', JSON.stringify({query: 'receipt', around: 'invalid'}));
    assert.equal(failed.status, 0); assert.equal(JSON.parse(failed.stdout).status, 'ERROR');
    for (let index = 0; index < 2; index++) assert.equal(command('query', arm, '7', 'read', 'refunds').status, 0);
    assert.equal(command('query', arm, '7', 'read', 'refunds').status, 1);
    assert.equal(command('query', arm, '3', 'read', 'refunds').status, 1);
    const search = command('query', arm, '4', 'search', 'refunds', JSON.stringify({query: 'exchange', maxBytes: 65536, limit: 25}));
    assert.equal(search.status, 0, search.stderr); assert(Buffer.byteLength(search.stdout) <= 4096);
    const events = readFileSync(join(directory, `audit-${arm}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(event => event.rejected).length, 2);
    assert.equal(events.filter(event => event.turn === 7 && !event.rejected).length, 3);
    assert.equal(events.at(-1).options.maxBytes, 4096);
  }
});

test('exercise report retains refresh history, identities and actual answer records without grading them', t => {
  const {directory, command, state} = exercise(t);
  for (const arm of ['before', 'after']) {
    for (const action of ['refresh', 'change']) assert.equal(command('control', arm, action).status, 0);
    assert.equal(command('query', arm, '1', 'read', 'refunds').status, 0);
    writeFileSync(join(directory, `answers-${arm}.json`), JSON.stringify(state.prompts.map((_, index) => ({turn: index + 1, answer: 'Synthetic transport-test answer; not model evidence.'}))));
  }
  const result = command('report'); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(directory, 'comparison.json'), 'utf8'));
  assert.equal(report.profile, 'sections'); assert.equal(report.variants.before.turns.length, 8);
  assert.deepEqual(report.variants.after.controls.map(value => value.operation), ['refresh', 'change']);
  assert.equal(report.variants.after.turns[2].retrievalCalls, 0);
  assert.equal(report.variants.after.turns[0].answer, 'Synthetic transport-test answer; not model evidence.');
  assert.equal(report.variants.after.turns[0].grade, undefined);
  assert(report.runtimeHashes.after['scripts/lib/context/search.mjs']);
});

test('malformed and double-encoded options are recorded as failed attempts inside the same budget', t => {
  const {directory, command} = exercise(t);
  for (const options of ['{', JSON.stringify(JSON.stringify({query: 'gift'})), 'null', '[]']) {
    const result = command('query', 'after', '6', 'search', 'refunds', options);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'ERROR');
  }
  const events = readFileSync(join(directory, 'audit-after.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 4);
  assert(events.every(event => event.value.status === 'ERROR' && event.events.length === 0));
});
