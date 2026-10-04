import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture} from './fixtures/execute.mjs';
import {commandFixture} from './fixtures/execute-commands.mjs';
import {diagnosticDelta} from '../scripts/lib/execute/commands.mjs';
test('diagnostics default end runs in the last browser step and failing steps only', async t => {
  const fixture = await executionFixture(t);
  for (const [lastBrowserStep, disabled, expected] of [[false, true, 0], [true, true, 2], [false, false, 2]]) {
    const f = commandFixture(fixture.projectRoot, {diagnostics: 'end', lastBrowserStep, disabled}); await f.commands.dispatch(['check', 'k1', '--read', 'state e1']); await f.commands.finalize('none'); assert.equal(f.calls.filter(call => call[0] === 'diagnostic').length, expected);
  }
});
test('request deltas retain failed/400+ paths, strip queries, and include late failure of an earlier request', () => {
  const state = {console: 0, requests: new Set()}, first = {result: '1. [GET] https://app.example.test/ok?secret=x => [200] OK\n2. [GET] https://app.example.test/error?q=private => [500] Fail'};
  assert.deepEqual(diagnosticDelta('requests', first, state).entries, [{kind: 'request', method: 'GET', origin: 'https://app.example.test', path: '/error', status: 500}]); assert.equal(diagnosticDelta('requests', first, state).entries.length, 0);
  assert.equal(diagnosticDelta('requests', {result: '1. [GET] https://app.example.test/ok?q=x => [FAILED] timeout'}, state).entries.length, 1);
  const consoleReply = {result: 'Total messages: 2001 (Errors: 1, Warnings: 0)\n[ERROR] Request https://app.example.test/error?q=private failed'}; const delta = diagnosticDelta('console', consoleReply, state); assert(delta.clear); assert(!JSON.stringify(delta.entries).includes('private')); assert.equal(diagnosticDelta('console', consoleReply, state).entries.length, 0);
});
