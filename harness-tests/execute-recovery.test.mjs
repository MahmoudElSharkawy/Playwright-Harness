import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {executionFixture} from './fixtures/execute.mjs';
import {recoverOwnedRun} from '../scripts/lib/browser/recovery.mjs';
import {nativeEnvironment} from '../scripts/lib/browser/native-cli.mjs';
import {withTransition, lockPaths, processIdentity} from '../scripts/lib/execute/lock.mjs';
import {writeJson, readBounded} from '../scripts/lib/execute/storage.mjs';

for (const survived of [false, true]) test(`L5 L6: recovery reserves stop/proof time and ${survived ? 'retains live ownership' : 'shares native environment'}`, async t => {
  const f = await executionFixture(t), run = join(f.projectRoot, 'recovery'), protectedRoot = join(run, 'protected'); mkdirSync(protectedRoot, {recursive: true});
  const session = 'harness_' + 'a'.repeat(32), tree = [{pid: 987654, identity: '123'}];
  writeJson(join(protectedRoot, 'native-ownership.json'), {version: 1, stage: 'opened', session, trees: [tree]}); writeFileSync(join(protectedRoot, 'native.json'), 'protected fixture');
  let elapsed = 0, probes = 0, stops = 0; const calls = [], options = {
    now: () => elapsed,
    call: async (exe, args, opts) => {const command = args.at(-1); calls.push({command, options: opts}); assert.deepEqual(opts.env, nativeEnvironment());
      if (command === 'close') {assert.equal(opts.timeoutMs, 10000); elapsed += 10000; return {kind: 'TIMEOUT', exitCode: null, stdout: ''};}
      assert(opts.timeoutMs <= 5000); return {exitCode: 0, stdout: JSON.stringify({browsers: []})};},
    gone: async (owned, deadline) => {assert.deepEqual(owned, tree); const remaining = deadline - Date.now(); assert(remaining > 0 && remaining <= 3000); probes++; if (probes === 1) {elapsed += 2000; throw new Error('slow initial probe');} elapsed += 500; return !survived;},
    stop: async (owned, deadline) => {assert.deepEqual(owned, tree); assert(deadline - Date.now() >= 4900); stops++; elapsed += 5000;}
  };
  const result = await recoverOwnedRun(f.roots.packageRoot, f.projectRoot, run, options);
  assert.equal(stops, 1); assert.equal(probes, 2); assert.equal(result.complete, !survived); assert.equal(existsSync(protectedRoot), survived);
  assert.deepEqual(calls.map(item => item.command), survived ? ['close'] : ['close', 'list', 'delete-data', 'list']);
});

test('L5 C8: a surviving native session or non-file ownership receipt preserves protected data', async t => {
  const f = await executionFixture(t), run = join(f.projectRoot, 'recovery'), protectedRoot = join(run, 'protected'); mkdirSync(protectedRoot, {recursive: true});
  const session = 'harness_' + 'b'.repeat(32), file = join(protectedRoot, 'native-ownership.json');
  writeJson(file, {version: 1, stage: 'opened', session, trees: [[{pid: 987654, identity: '1'}]]});
  const calls = [], call = async (_, args) => {calls.push(args.at(-1)); return args.at(-1) === 'close' ? {exitCode: 1, stdout: ''} : {exitCode: 0, stdout: JSON.stringify({browsers: [{name: session}]})};};
  assert.equal((await recoverOwnedRun(f.roots.packageRoot, f.projectRoot, run, {call, gone: async () => true})).complete, false);
  assert.deepEqual(calls, ['close', 'list']); assert(existsSync(file));
  const malformed = join(f.projectRoot, 'malformed'); mkdirSync(join(malformed, 'protected/native-ownership.json'), {recursive: true});
  assert.equal((await recoverOwnedRun(f.roots.packageRoot, f.projectRoot, malformed, {call})).complete, false); assert.equal(calls.length, 2);
});

test('L2: incomplete mutex is bounded BUSY and an old owner cannot delete its replacement', async t => {
  const f = await executionFixture(t), paths = lockPaths(f.roots), inventory = async () => [{pid: process.pid, identity: '100'}];
  writeFileSync(paths.mutex, ''); let entered = false;
  await assert.rejects(withTransition(f.roots, () => {entered = true;}, {inventory, attempts: 2}), /BUSY/); assert.equal(entered, false);
  writeJson(paths.mutex, {pid: 987654, identity: '200', nonce: 'stale'});
  await withTransition(f.roots, () => writeJson(paths.mutex, {pid: process.pid, identity: '100', nonce: 'replacement'}), {inventory});
  assert.equal(readBounded(paths.mutex).nonce, 'replacement');
});

test('U5: only this host identity is cached; other-process creation identities stay fresh', async () => {
  let calls = 0, identity = '1'; const inventory = async () => {calls++; return [{pid: process.pid, identity: 'host'}, {pid: 987654, identity}];};
  await processIdentity(process.pid, inventory); await processIdentity(process.pid, inventory); assert.equal(calls, 1);
  assert.equal((await processIdentity(987654, inventory)).identity, '1'); identity = '2'; assert.equal((await processIdentity(987654, inventory)).identity, '2'); assert.equal(calls, 3);
});
