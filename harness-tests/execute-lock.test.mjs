import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture} from './fixtures/execute.mjs';
import {acquireLauncher, claimHost, releaseHost, lockPaths, withTransition} from '../scripts/lib/execute/lock.mjs';
import {readBounded, writeJson} from '../scripts/lib/execute/storage.mjs';
test('live creation identity prevents reclaim; dead ownership requires recovery and nonce CAS', async t => {
  const f = await executionFixture(t); let creation = '100', recoveries = 0;
  const inventory = async () => [{pid: process.pid, parent: 1, identity: creation}], options = {inventory, recover: async () => {recoveries++; return {complete: true};}};
  const first = await acquireLauncher(f.roots, {executionId: 'execute-one', runId: 'run1'}, options); await assert.rejects(acquireLauncher(f.roots, {executionId: 'execute-two', runId: 'run2'}, options), /BUSY/); assert.equal(recoveries, 0);
  await claimHost(f.roots, first.nonce, options); assert.equal(readBounded(lockPaths(f.roots).lock).state, 'running');
  creation = '101'; const second = await acquireLauncher(f.roots, {executionId: 'execute-two', runId: 'run2'}, options); assert.equal(recoveries, 1);
  assert.equal(await releaseHost(f.roots, first.nonce, options), false); assert.equal(readBounded(lockPaths(f.roots).lock).nonce, second.nonce); await assert.rejects(claimHost(f.roots, first.nonce, options), /ownership changed/); await releaseHost(f.roots, second.nonce, options);
});
test('failed recovery retains the lock for remediation', async t => {
  const f = await executionFixture(t); let creation = '100'; const inventory = async () => [{pid: process.pid, identity: creation}];
  await acquireLauncher(f.roots, {executionId: 'execute-one', runId: 'run1'}, {inventory}); creation = '101'; await assert.rejects(acquireLauncher(f.roots, {executionId: 'execute-two', runId: 'run2'}, {inventory, recover: async () => ({complete: false})}), /remediation/); assert.equal(readBounded(lockPaths(f.roots).lock).runId, 'run1');
});

test('a delayed stale inspection cannot remove a replacement transition owner', async t => {
  const f = await executionFixture(t); writeJson(lockPaths(f.roots).mutex, {pid: 999999, identity: 'old', nonce: 'stale'});
  let calls = 0, resumeInspection, resumeAction, entered;
  const inspected = new Promise(resolve => {resumeInspection = resolve;}), hold = new Promise(resolve => {resumeAction = resolve;}), active = new Promise(resolve => {entered = resolve;});
  const inventory = async () => {if (++calls === 4) await inspected; return [{pid: process.pid, identity: '100'}];};
  let concurrent = 0, maximum = 0;
  const action = async () => {maximum = Math.max(maximum, ++concurrent); entered(); await hold; concurrent--;};
  const first = withTransition(f.roots, action, {inventory, attempts: 2}), second = withTransition(f.roots, action, {inventory, attempts: 2});
  await active; const owner = readBounded(lockPaths(f.roots).mutex); resumeInspection(); await assert.rejects(second, /BUSY/);
  assert.deepEqual(readBounded(lockPaths(f.roots).mutex), owner); assert.equal(maximum, 1); resumeAction(); await first;
});
