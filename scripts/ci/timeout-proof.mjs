#!/usr/bin/env node
// Actual cancellation/forced-timeout evaluation, separate from scenario verdict tests.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, renameSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';
import {prepareNativeSession} from '../lib/browser/native-cli.mjs';
import {processCall, treeGone} from '../lib/browser/processes.mjs';
import {hostDatabases} from '../../harness-tests/fixtures/host-databases.mjs';
import {nativeProcess} from './native-process.mjs';
import {recoverNativeProof} from './recovery.mjs';

const [argument, kind] = process.argv.slice(2);
assert(process.argv.length === 4 && ['browser', 'mixed'].includes(kind), 'Use <new-external-workspace> browser|mixed.');
assert(!within(packageRoot, realFuture(resolve(argument)))); mkdirSync(argument, {mode: 0o700}); const root = realpathSync.native(argument);
if (process.platform === 'win32') {
  const who = await processCall('whoami', []); assert.equal(who.exitCode, 0);
  assert.equal((await processCall('icacls', [root, '/inheritance:r', '/grant:r', `${who.stdout.trim()}:(OI)(CI)F`])).exitCode, 0);
}
const unrelated = join(root, 'unrelated'); mkdirSync(unrelated);
let sentinel, databases, accepted = false; const records = [], unrelatedContainers = [];
try {
  if (kind === 'mixed') databases = await hostDatabases({recordOwnership: record => unrelatedContainers.push(record)});
  sentinel = await prepareNativeSession({...consumerRoots(unrelated), runRoot: join(unrelated, '.harness/runs/sentinel')}, {origins: ['http://fixture.test']}); await sentinel.open();
  for (const {name, cooperative, loseOpenReceipt} of [{name: 'cooperative', cooperative: true}, {name: 'forced', cooperative: false}, {name: 'lost-open-receipt', cooperative: false, loseOpenReceipt: true}]) {
    const consumer = join(root, name); mkdirSync(consumer);
    writeFileSync(join(consumer, 'request.json'), JSON.stringify({kind, cooperative, loseOpenReceipt}), {flag: 'wx', mode: 0o600});
    const processResult = await nativeProcess(join(packageRoot, 'harness-tests/fixtures/ci-timeout.mjs'), consumer, {cwd: root, log: join(root, `${name}.log`), timeoutMs: 60000, graceMs: 30000});
    const recovery = await recoverNativeProof(packageRoot, consumer);
    assert.equal(processResult.status, 'FAIL'); assert.equal(processResult.diagnostic, 'TIMEOUT'); assert(processResult.ownedProcessesStopped);
    const ready = JSON.parse(readFileSync(join(consumer, 'ready.json'), 'utf8')); assert(ready.trees.length > 0);
    for (const tree of ready.trees) assert(await treeGone(tree), 'Owned browser survived timeout recovery.');
    const protectedRoot = join(consumer, '.harness/runs/batch/scenario/protected'); let ownerReconciliation;
    if (loseOpenReceipt && !recovery.complete) {
      // Some hosts already killed the daemon. With no PID receipt, automatic
      // recovery must retain uncertainty and protected storage, not invent success.
      assert.deepEqual(recovery.failures, ['BROWSER_RECOVERY']); assert(existsSync(protectedRoot));
      const record = JSON.parse(readFileSync(join(protectedRoot, 'native-ownership.json'), 'utf8'));
      assert.equal(record.session, ready.session); assert.equal(record.stage, 'opening'); assert.deepEqual(record.trees, []);
      writeFileSync(join(consumer, 'recovery-uncertain.json'), JSON.stringify(recovery), {flag: 'wx', mode: 0o600});
      // The fault fixture kept a separate authentic owner receipt before deleting
      // its normal PID bookkeeping. Use that witness only for test teardown,
      // after asserting the conservative automatic result above.
      const next = join(protectedRoot, 'native-ownership.next.json');
      writeFileSync(next, JSON.stringify({...record, stage: 'opened', trees: ready.trees}), {flag: 'wx', mode: 0o600});
      renameSync(next, join(protectedRoot, 'native-ownership.json'));
      ownerReconciliation = await recoverNativeProof(packageRoot, consumer); assert(ownerReconciliation.complete); assert.equal(ownerReconciliation.browsers, 1);
    } else assert(recovery.complete);
    assert(!existsSync(protectedRoot));
    if (cooperative) assert(JSON.parse(readFileSync(join(consumer, 'cooperative-cleanup.json'), 'utf8')).browser);
    else {assert.equal(recovery.browsers + (ownerReconciliation?.browsers ?? 0), 1); assert.equal(recovery.databases, kind === 'mixed' ? 2 : 0);}
    assert.equal(JSON.parse((await sentinel.command(['eval', 'document.title'])).result), '');
    for (const container of unrelatedContainers) {
      const inspected = await processCall('docker', ['container', 'inspect', '--format', '{{.State.Running}} {{index .Config.Labels "playwright-harness.owner"}}', container.name]);
      assert.equal(inspected.exitCode, 0); assert.equal(inspected.stdout.trim(), `true ${container.owner}`);
    }
    records.push({name, cooperative, status: 'PASS', deadlineRemainedFailure: true, ownedBrowserStopped: true, protectedStorageRemoved: true, unrelatedBrowserSurvived: true,
      unrelatedContainersSurvived: unrelatedContainers.length, recovery,
      ...(ownerReconciliation ? {uncertaintyPreserved: true, protectedStorageRetainedBeforeOwnerReconciliation: true, ownerReconciliation} : {})});
  }
  accepted = true;
} finally {
  const closed = await sentinel?.close(); await databases?.close();
  const summary = {version: 1, status: accepted && closed?.complete ? 'PASS' : 'INCOMPLETE', platform: process.platform, kind, records, sentinelCleanup: closed?.complete === true};
  writeFileSync(join(root, 'timeout-proof.json'), JSON.stringify(summary, null, 2), {flag: 'wx', mode: 0o600}); console.log(JSON.stringify(summary));
  if (summary.status !== 'PASS') process.exitCode = 1;
}
