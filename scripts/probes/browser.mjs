#!/usr/bin/env node
// Fixed live M6 acceptance fixtures. This is validation, not another browser language.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, stat, lstat, realpath, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRun, defineOperation} from '../lib/execution-core/index.mjs';
import {browserLifecycleOperations, runBrowserScenario} from '../lib/browser/index.mjs';
import {prepareNativeSession, NativeFailure} from '../lib/browser/native-cli.mjs';
import {processCall, stopTree, treeGone} from '../lib/browser/processes.mjs';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {within} from '../lib/skill-roots.mjs';
import {inventory} from '../lib/package-validation.mjs';
import {browserFixture} from '../../harness-tests/fixtures/browser-app.mjs';

if (process.argv.length !== 3) throw new Error('Provide one new external consumer directory for the live browser proof.');
const projectRoot = resolve(process.argv[2]);
if (within(packageRoot, projectRoot)) throw new Error('The browser proof needs a separate consumer outside the package.');
await mkdir(projectRoot, {mode: 0o700});
consumerRoots(projectRoot);
if (process.platform === 'win32') {
  const owner = await processCall('whoami', []), acl = await processCall('icacls', [projectRoot, '/inheritance:r', '/grant:r', `${owner.stdout.trim()}:(OI)(CI)F`]);
  assert.equal(owner.exitCode, 0); assert.equal(acl.exitCode, 0);
}
const digest = async () => {
  const files = inventory(packageRoot).files, rows = await Promise.all(files.map(async file => `${file}:${createHash('sha256').update(await readFile(join(packageRoot, file))).digest('hex')}`));
  return {files: files.length, sha256: createHash('sha256').update(rows.join('\n')).digest('hex')};
};
const before = await digest(), fixture = await browserFixture(), checks = [];
const roots = name => ({packageRoot, projectRoot, runRoot: join(projectRoot, '.harness', 'runs', name)});
const environment = {name: 'qa', environmentMode: 'test', apiTargets: [], databaseTargets: [], browserTargets: ['app'], targets: {api: {}, databases: {}, browser: {app: {origins: [fixture.origin]}}}};
const op = mutation => defineOperation({id: 'exercise', family: 'browser', target: 'app', capability: mutation ? 'browserMutations' : 'browserReads', source: {kind: 'inline', reference: 'synthetic-browser-case', version: '1.0.0'}, definition: {intent: 'Observe synthetic browser behavior'}});
const observed = async (context, actual, expected, moreEvidence = []) => {
  const proof = await context.evidence('observation', {actual, expected});
  context.assertion({id: 'expected', status: actual === expected ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [proof, ...moreEvidence]});
};
async function check(name, action) {
  try {const facts = await action(); checks.push({name, status: 'PASS', facts});}
  catch (error) {checks.push({name, status: 'FAIL', failure: error.name, message: error.message});}
  console.log(JSON.stringify(checks.at(-1))); fixture.available(true);
}
async function scenario(name, expectedStatus, action, {mutation = false, retry = false, environmentMode = 'test', requiredEvidence = ['observation'], storageState, commandTimeoutMs = 15000, runTimeoutMs = 120000, signal, beforeAttempt, afterAttempt} = {}) {
  const operation = op(mutation), run = createRun({id: name, startedAt: Date.now(), environment: {...environment, environmentMode}, operations: [operation, ...browserLifecycleOperations('app')],
    scenarios: [{id: name, expectations: [{id: 'expected', description: 'Synthetic observation matches', operationId: operation.id, invocationId: 'exercise-call', requiredEvidence}]}], limits: {timeoutMs: runTimeoutMs, cleanupTimeoutMs: 60000}});
  let attempts = 0;
  const result = await runBrowserScenario(run, roots(name), {target: 'app', storageState, commandTimeoutMs, nativeTimeoutMs: 2500, signal}, async browser => {
    if (beforeAttempt) await beforeAttempt(browser);
    await browser.attempt({operation, invocationId: 'exercise-call', retry}, async context => {attempts++; await action(context, browser, attempts);});
    if (afterAttempt) await afterAttempt(browser);
  });
  assert.equal(result.status, expectedStatus); assert.equal(result.scenarios[0].requiredLifecycleComplete, true);
  const cleanup = result.scenarios[0].attempts.at(-1), proof = result.evidence.find(item => cleanup.evidenceIds.includes(item.id));
  const facts = JSON.parse(await readFile(join(roots(name).runRoot, proof.path), 'utf8'));
  assert.equal(facts.complete, true); assert.equal(facts.stopped, true); assert.equal(facts.authenticationRemoved, true);
  await assert.rejects(stat(join(roots(name).runRoot, 'protected')), {code: 'ENOENT'});
  return {result, facts: {verdict: result.status, stability: result.stability, attempts, evidence: result.evidence.length, ownedCleanup: true}};
}

let sentinel;
try {
  sentinel = await prepareNativeSession(roots('authentication-seed'), {origins: [fixture.origin]});
  await sentinel.open(); await sentinel.command(['goto', fixture.origin]); await sentinel.command(['click', '#login']);
  const savedState = join(sentinel.workRoot, 'synthetic-state.json'); await sentinel.command(['state-save', savedState]);
  assert.equal(fixture.counts.logins, 1);
  await check('success-evidence', async () => {
    const run = await scenario('success-evidence', 'PASS', async context => {
      await context.native(['goto', `${fixture.origin}/?a=one&b=two`]);
      await context.native(['snapshot', '--filename=page.yml']); await context.native(['screenshot', '--filename=page.png']);
      const snapshot = await context.artifact('snapshot', 'page.yml', bytes => {assert.match(bytes.toString(), /Public fixture/); return bytes;});
      const screenshot = await context.artifact('screenshot', 'page.png', bytes => {assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); return bytes;});
      const title = JSON.parse((await context.native(['eval', 'document.querySelector("h1").textContent'])).result);
      await observed(context, title, 'Public fixture', [snapshot, screenshot]);
    }, {requiredEvidence: ['observation','snapshot','screenshot']}); return run.facts;
  });
  await check('assertion-failure', async () => {
    const run = await scenario('assertion-failure', 'FAIL', async context => {await context.native(['goto', fixture.origin]); await observed(context, JSON.parse((await context.native(['eval', 'document.querySelector("h1").textContent'])).result), 'Different heading');}, {retry: true});
    assert.equal(run.facts.attempts, 1); return run.facts;
  });
  await check('outage', async () => {
    fixture.available(false);
    return (await scenario('outage', 'BLOCKED', async context => {await context.native(['goto', fixture.origin]); await observed(context, 'unreachable', 'reachable');})).facts;
  });
  await check('safe-recovery', async () => {
    fixture.available(false);
    const run = await scenario('safe-recovery', 'PASS', async context => {
      try {await context.native(['goto', fixture.origin]);} catch (error) {fixture.available(true); throw error;}
      await observed(context, JSON.parse((await context.native(['eval', 'document.querySelector("h1").textContent'])).result), 'Public fixture');
    }, {retry: true}); assert.equal(run.facts.attempts, 2); assert.equal(run.facts.stability, 'recovered'); return run.facts;
  });
  await check('uncertain-mutation', async () => {
    const beforeMutations = fixture.counts.mutations;
    const run = await scenario('uncertain-mutation', 'NEEDS_REVIEW', async context => {
      await context.native(['goto', fixture.origin]);
      await context.native(['run-code', 'async page => {await page.locator("#save").click(); await page.waitForTimeout(15000);}']);
      await observed(context, 'unexpected response', 'completed');
    }, {mutation: true, retry: true, commandTimeoutMs: 4000});
    assert.equal(run.facts.attempts, 1); assert.equal(fixture.counts.mutations - beforeMutations, 1); return {...run.facts, mutations: 1};
  });
  await check('daemon-crash', async () => {
    const run = await scenario('daemon-crash', 'BLOCKED', async (context, browser) => {
      const daemon = browser.ownership()[0][0]; process.kill(daemon.pid, 'SIGKILL');
      await context.native(['snapshot']); await observed(context, 'unexpected success', 'crash');
    }); return run.facts;
  });
  await check('authentication-restore', async () => {
    const run = await scenario('authentication-restore', 'PASS', async context => {
      await context.native(['goto', `${fixture.origin}/account`]);
      await observed(context, JSON.parse((await context.native(['eval', 'document.querySelector("h1").textContent'])).result), 'Signed in');
    }, {storageState: savedState}); assert.equal(fixture.counts.logins, 1); return {...run.facts, totalLogins: 1};
  });
  await check('stale-authentication', async () => {
    fixture.expire();
    const run = await scenario('stale-authentication', 'BLOCKED', async context => {
      await context.native(['goto', `${fixture.origin}/account`]);
      const actual = JSON.parse((await context.native(['eval', 'document.querySelector("h1").textContent'])).result);
      assert.equal(actual, 'Sign in required'); await context.evidence('observation', {authentication: 'stale'});
      throw new NativeFailure('UNAVAILABLE', true);
    }, {storageState: savedState}); assert.equal(fixture.counts.logins, 1); return {...run.facts, totalLogins: 1};
  });
  await check('cancellation', async () => {
    const controller = new AbortController();
    return (await scenario('cancellation', 'BLOCKED', async context => {
      await context.native(['goto', fixture.origin]);
      const timer = setTimeout(() => controller.abort(), 1000);
      try {await context.native(['run-code', 'async page => {await page.waitForTimeout(15000);}']);} finally {clearTimeout(timer);}
    }, {signal: controller.signal})).facts;
  });
  await check('cancellation-between-commands', async () => {
    const controller = new AbortController();
    const run = await scenario('cancellation-between-commands', 'BLOCKED', async context => {
      await context.native(['goto', fixture.origin]); await observed(context, JSON.parse((await context.native(['eval', 'document.title'])).result), 'Synthetic browser fixture');
      controller.abort(); await new Promise(() => {});
    }, {signal: controller.signal});
    assert.equal(run.result.scenarios[0].attempts[1].failureClass, 'CANCELLED'); return run.facts;
  });
  await check('callback-deadline', async () => {
    let expired;
    const run = await scenario('callback-deadline', 'BLOCKED', async context => {
      expired = context; await context.native(['goto', fixture.origin]); await new Promise(() => {});
    }, {runTimeoutMs: 8000});
    assert.equal(run.result.scenarios[0].attempts[1].failureClass, 'TIMEOUT'); assert.throws(() => expired.native(['snapshot']), /ended/); return run.facts;
  });
  await check('body-deadline', async () => {
    let expired;
    const run = await scenario('body-deadline', 'NEEDS_REVIEW', async context => {
      await context.native(['goto', fixture.origin]); await observed(context, JSON.parse((await context.native(['eval', 'document.title'])).result), 'Synthetic browser fixture');
    }, {runTimeoutMs: 8000, afterAttempt: async browser => {expired = browser; await new Promise(() => {});}});
    await assert.rejects(expired.attempt({operation: op(false), invocationId: 'late'}, async () => {}), /active scenario/); return run.facts;
  });
  await check('deadline-before-required-invocation', async () => {
    const run = await scenario('deadline-before-required-invocation', 'BLOCKED', async () => {throw new Error('Unreachable callback was invoked');}, {runTimeoutMs: 8000, beforeAttempt: async () => {await new Promise(() => {});}});
    assert.equal(run.facts.attempts, 0); assert.equal(run.result.scenarios[0].attempts[1].effect.certainty, 'not-executed');
    assert.equal(run.result.scenarios[0].attempts[1].assertions[0].status, 'NOT_EVALUATED'); return run.facts;
  });
  await check('policy-refusal-after-deadline', async () => {
    const run = await scenario('policy-refusal-after-deadline', 'BLOCKED', async () => {throw new Error('Denied mutation was invoked');}, {mutation: true, environmentMode: 'protected', runTimeoutMs: 8000, beforeAttempt: async () => {await new Promise(() => {});}});
    assert.equal(run.facts.attempts, 0); assert.equal(run.result.scenarios[0].attempts[1].failureClass, 'POLICY');
    assert.equal(run.result.scenarios[0].attempts[1].effect.certainty, 'not-executed'); return run.facts;
  });
  await check('sanitizer-deadline', async () => {
    let release;
    const run = await scenario('sanitizer-deadline', 'BLOCKED', async context => {
      await context.native(['goto', fixture.origin]); await context.native(['snapshot', '--filename=page.yml']);
      await context.artifact('snapshot', 'page.yml', () => new Promise(resolveBytes => {release = resolveBytes;}));
    }, {runTimeoutMs: 8000});
    assert.equal(run.result.scenarios[0].attempts[1].failureClass, 'TIMEOUT'); assert.ok(release);
    release(Buffer.from('late sanitized bytes')); await new Promise(resolveTick => setImmediate(resolveTick));
    assert.equal(run.result.evidence.some(item => item.kind === 'snapshot'), false); return run.facts;
  });
  await check('unawaited-native-work', async () => {
    return (await scenario('unawaited-native-work', 'BLOCKED', async context => {
      await context.native(['goto', fixture.origin]);
      void context.native(['run-code', 'async page => {await page.waitForTimeout(500); return await page.title();}']);
    })).facts;
  });
  await check('expired-attempt-context', async () => {
    let expired;
    const run = await scenario('expired-attempt-context', 'PASS', async context => {
      expired = context; await context.native(['goto', fixture.origin]); await observed(context, JSON.parse((await context.native(['eval', 'document.title'])).result), 'Synthetic browser fixture');
    });
    assert.throws(() => expired.native(['snapshot']), /ended/); assert.throws(() => expired.evidence('observation', {late: true}), /ended/); return run.facts;
  });
  await check('assertion-history-preserved', async () => {
    return (await scenario('assertion-history-preserved', 'FAIL', async context => {
      await context.native(['goto', fixture.origin]); await observed(context, JSON.parse((await context.native(['eval', 'document.title'])).result), 'Different title');
      context.assertion({id: 'expected', status: 'PASS', reliable: true, evidenceIds: []});
    })).facts;
  });
  await check('intentional-persistence', async () => {
    const beforeMutations = fixture.counts.mutations;
    const run = await scenario('intentional-persistence', 'PASS', async context => {
      await context.native(['goto', fixture.origin]); await context.native(['click', '#save']);
      const count = Number(JSON.parse((await context.native(['eval', 'document.querySelector("#count").textContent'])).result));
      const identity = context.output({name: 'fixtureIdentity', type: 'number', sensitivity: 'public', value: count});
      context.selectOutput({attemptId: identity.producer.attemptId, name: identity.name});
      context.resource({id: 'persistent-record', identity: {attemptId: identity.producer.attemptId, name: identity.name}, ownership: 'harness', intent: 'persistent', lifecycle: {action: 'retain', status: 'not-required', evidenceIds: []}});
      context.effect({certainty: 'confirmed', resourceIds: ['persistent-record']}); await observed(context, count, beforeMutations + 1);
    }, {mutation: true}); assert.equal(fixture.counts.mutations, beforeMutations + 1); assert.equal(run.result.scenarios[0].outputs[0].value, beforeMutations + 1); return {...run.facts, retainedByIntent: true};
  });
  await check('earlier-effect-claim-invalidated', async () => {
    const beforeMutations = fixture.counts.mutations;
    return (await scenario('earlier-effect-claim-invalidated', 'NEEDS_REVIEW', async context => {
      context.effect({certainty: 'none', resourceIds: []});
      await context.native(['goto', fixture.origin]); await context.native(['click', '#save']);
      const count = Number(JSON.parse((await context.native(['eval', 'document.querySelector("#count").textContent'])).result));
      await observed(context, count, beforeMutations + 1);
    }, {mutation: true})).facts;
  });
  await check('cleanup-failure-preserved', async () => {
    const owned = await prepareNativeSession(roots('cleanup-failure-probe'), {origins: [fixture.origin]});
    let recovered;
    try {await owned.open(); const expired = await owned.close({deadlineAt: Date.now()}); assert.equal(expired.complete, false); assert.equal(expired.authenticationRemoved, false);}
    finally {recovered = await owned.close();}
    assert.equal(recovered.complete, false); assert.equal(recovered.stopped, true); assert.equal(recovered.authenticationRemoved, true); assert.ok(recovered.failures.length > 0);
    return {failurePreserved: true, processesStopped: true, privateStorageRemoved: true};
  });
  await check('temporary-fixture-lifecycle', async () => {
    const operation = name => defineOperation({id: name, family: 'browser', target: 'app', capability: 'browserMutations', source: {kind: 'helper', reference: 'synthetic-fixture-lifecycle', version: '1.0.0'}, definition: {intent: name}});
    const setup = operation('fixture-create'), cleanup = operation('fixture-remove'), name = 'temporary-fixture-lifecycle';
    const run = createRun({id: name, environment, operations: [setup, cleanup, ...browserLifecycleOperations('app')], scenarios: [{id: name, expectations: [{id: 'expected', description: 'Synthetic fixture exists', operationId: setup.id, invocationId: 'create', requiredEvidence: ['observation']}]}], limits: {timeoutMs: 60000, cleanupTimeoutMs: 60000}});
    const result = await runBrowserScenario(run, roots(name), {target: 'app'}, async browser => {
      const creation = await browser.attempt({operation: setup, invocationId: 'create', phase: 'SETUP'}, async context => {
        await context.native(['goto', fixture.origin]); await context.native(['eval', 'localStorage.setItem("syntheticFixture","present")']);
        const actual = JSON.parse((await context.native(['eval', 'localStorage.getItem("syntheticFixture")'])).result);
        const identity = context.output({name: 'fixtureIdentity', type: 'string', sensitivity: 'public', value: 'syntheticFixture'});
        context.resource({id: 'temporary-fixture', identity: {attemptId: identity.producer.attemptId, name: identity.name}, ownership: 'harness', intent: 'temporary', lifecycle: {action: 'cleanup', status: 'pending', evidenceIds: []}});
        context.effect({certainty: 'confirmed', resourceIds: ['temporary-fixture']}); await observed(context, actual, 'present');
      });
      await browser.attempt({operation: cleanup, invocationId: 'remove', phase: 'CLEANUP', inputs: creation.outputs}, async context => {
        await context.native(['eval', 'localStorage.removeItem("syntheticFixture")']);
        const actual = JSON.parse((await context.native(['eval', 'localStorage.getItem("syntheticFixture")'])).result); assert.equal(actual, null);
        context.effect({certainty: 'confirmed', resourceIds: ['temporary-fixture']});
        const proof = await context.evidence('lifecycle', {absent: actual === null});
        assert.throws(() => context.lifecycle('temporary-fixture', {intent: 'persistent'}), /cannot change/);
        context.lifecycle('temporary-fixture', {status: 'completed', evidenceIds: [proof]});
        assert.throws(() => context.lifecycle('temporary-fixture', {status: 'pending', evidenceIds: []}), /already completed/);
      });
    });
    assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].requiredLifecycleComplete, true);
    const resource = result.scenarios[0].resources.find(item => item.id === 'temporary-fixture');
    assert.equal(resource.lifecycle.status, 'completed'); assert.notEqual(resource.originAttemptId, resource.lifecycle.attemptId);
    await assert.rejects(stat(join(roots(name).runRoot, 'protected')), {code: 'ENOENT'});
    return {verdict: result.status, originalIdentityPreserved: true, requiredLifecycleComplete: true};
  });
  await check('exhausted-cleanup-window', async () => {
    const name = 'exhausted-cleanup-window', operation = op(false);
    const run = createRun({id: name, environment, operations: [operation, ...browserLifecycleOperations('app')], scenarios: [{id: name, expectations: [{id: 'expected', description: 'Synthetic title matches', operationId: operation.id, invocationId: 'exercise-call', requiredEvidence: ['observation']}]}], limits: {timeoutMs: 60000, cleanupTimeoutMs: 2000}});
    let ownership = [], result;
    try {
      result = await runBrowserScenario(run, roots(name), {target: 'app'}, async browser => {
        ownership = browser.ownership();
        await browser.attempt({operation, invocationId: 'exercise-call'}, async context => {
          await context.native(['goto', fixture.origin]); await observed(context, JSON.parse((await context.native(['eval', 'document.title'])).result), 'Synthetic browser fixture');
        });
        await browser.attempt({operation, invocationId: 'cleanup-wait', phase: 'CLEANUP'}, async context => {await context.native(['eval', 'document.title']); await new Promise(() => {});});
      });
      assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.scenarios[0].requiredLifecycleComplete, false);
      const cleanup = result.scenarios[0].attempts.at(-1); assert.equal(cleanup.failureClass, 'TIMEOUT'); assert.equal(cleanup.effect.certainty, 'not-executed');
      assert.equal((await stat(join(roots(name).runRoot, 'protected'))).isDirectory(), true);
    } finally {
      // Separate fixture remediation after the intentionally exhausted automatic budget.
      // Preserve the failed run and its verdict; this is not retry-to-green.
      const workRoot = await realpath(join(roots(name).runRoot, 'protected'));
      const records = JSON.parse(await readFile(join(roots(name).runRoot, 'observations.json'), 'utf8'));
      const session = records.scenarios[0].attempts[0].outputs.find(value => value.name === 'sessionIdentity').value;
      const cli = join(packageRoot, 'scripts/spikes/playwright-cli/node_modules/@playwright/cli/playwright-cli.js');
      const options = {cwd: workRoot, timeoutMs: 30000, env: {...process.env, CI: '1', NO_UPDATE_NOTIFIER: '1'}};
      const close = await processCall(process.execPath, [cli, '--json', `-s=${session}`, 'close'], options);
      for (const tree of ownership) if (!await treeGone(tree)) await stopTree(tree, Date.now() + 30000);
      const removed = await processCall(process.execPath, [cli, '--json', `-s=${session}`, 'delete-data'], options);
      assert.ok(ownership.length && (await Promise.all(ownership.map(tree => treeGone(tree)))).every(Boolean));
      assert.equal(close.exitCode, 0); assert.equal(removed.exitCode, 0);
      assert.ok(within(await realpath(roots(name).runRoot), workRoot) && within(await realpath(projectRoot), workRoot) && !within(await realpath(packageRoot), workRoot) && !(await lstat(workRoot)).isSymbolicLink());
      await rm(workRoot, {recursive: true});
      await writeFile(join(roots(name).runRoot, 'fixture-recovery.json'), JSON.stringify({originalStatus: result?.status ?? 'invalid', ownedProcessesStopped: true, privateStorageRemoved: true}), {mode: 0o600, flag: 'wx'});
    }
    assert.equal(JSON.parse(await readFile(join(roots(name).runRoot, 'result.json'), 'utf8')).status, 'NEEDS_REVIEW');
    return {verdict: result.status, automaticCleanupCompleted: false, separateFixtureRecovery: true};
  });
  await check('unrelated-session-retained', async () => {
    assert.equal(JSON.parse((await sentinel.command(['eval', 'document.title'])).result), 'Synthetic browser fixture');
    return {sentinelSurvived: true};
  });
} finally {
  await check('seed-cleanup', async () => {const result = await sentinel?.close(); assert.equal(result?.complete, true); return result;});
  await fixture.close();
  await check('package-immutable', async () => {const after = await digest(); assert.deepEqual(after, before); return after;});
  const summary = {platform: process.platform, node: process.version, checks, status: checks.length === 26 && checks.every(check => check.status === 'PASS') ? 'PASS' : 'INCOMPLETE'};
  await writeFile(join(projectRoot, 'browser-proof.json'), JSON.stringify(summary, null, 2), {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({status: summary.status, passed: checks.filter(check => check.status === 'PASS').length, checks: checks.length}));
  if (summary.status !== 'PASS') process.exitCode = 1;
}
