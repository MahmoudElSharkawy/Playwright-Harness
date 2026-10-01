import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/sequential.mjs';
import {operation as api, statusCheck} from './fixtures/api.mjs';
import {defineOperation} from '../scripts/lib/execution-core/index.mjs';

// Real native browser controls; also imported by the Windows/Linux mixed SQL proof.
const cases = [
  ['fixed success code', 'OK', 'pass', true],
  ['fixed boolean', true, 'pass', false],
  ['native command name', 'goto', 'pass', true],
  ['ordinary confidential text', randomUUID(), 'pass', true],
  ['callback diagnostics', randomUUID(), 'error', true],
  ['public observation refusal', randomUUID(), 'evidence', true],
  ['public output refusal', randomUUID(), 'output', true],
  ['automatic observation write failure', randomUUID(), 'write', true]
];
for (const [label, value, mode, mutates] of cases) test(`mixed browser preserves effects and cleanup with ${label}`, async t => {
  let present = false, mutations = 0, cleanupCalls = 0, injected = false;
  const load = api('load', {path: '/load', checks: [statusCheck('loaded', 200)],
    extract: [{name: 'classified', type: typeof value, sensitivity: 'sensitive', select: {from: 'json', path: ['classified']}}]});
  const operation = defineOperation({id: 'browser-case', family: 'browser', target: 'ui', capability: mutates ? 'browserMutations' : 'browserReads',
    source: {kind: 'inline', reference: 'synthetic-browser-control', version: '1'}, definition: {intent: 'Observe the synthetic fixture'}});
  const clean = api('clean', {method: 'DELETE', path: '/change', checks: [statusCheck('cleaned', 204)]});
  const f = await fixture(t, [{operation: load, phase: 'SETUP'}, {operation, phase: 'EXERCISE', checks: [{id: 'browser-checked'}]},
    ...(mutates ? [{operation: clean, phase: 'CLEANUP'}] : [])], {browser: true, handler: ({request, reply}) => {
    if (request.path === '/load') return reply(200, {classified: value});
    if (request.method === 'POST') {present = true; mutations++; return reply(201, {id: 'fixture-item'});}
    if (request.method === 'DELETE') {present = false; cleanupCalls++; return reply(204);}
    reply(200, {fixture: 'ready'});
  }});
  const originalWrite = fs.writeFile;
  if (mode === 'write') {
    fs.writeFile = async (...args) => {
      if (!injected && Buffer.isBuffer(args[1]) && args[1].toString().startsWith('{"nativeEvents"')) {injected = true; throw new Error('Synthetic evidence write failure.');}
      return originalWrite(...args);
    };
    syncBuiltinESMExports();
  }
  let result;
  try {
    result = await f.start({setup: ctx => ctx.api.execute({operation: load, invocationId: 'load'}),
      exercise: ctx => ctx.browser.attempt({operation, invocationId: 'browser-case'}, async browser => {
        await browser.native(['goto', f.origin]);
        if (mutates) {
          await browser.native(['eval', "fetch('/change',{method:'POST'}).then(r=>r.json())"]);
          const identity = browser.output({name: 'recordId', type: 'string', sensitivity: 'public', value: 'fixture-item'});
          browser.resource({id: 'row', identity: {attemptId: identity.producer.attemptId, name: identity.name}, ownership: 'harness', intent: 'temporary', lifecycle: {action: 'cleanup', status: 'pending', evidenceIds: []}});
          browser.effect({certainty: 'confirmed', resourceIds: ['row']});
        }
        if (mode === 'error') {const error = new Error(value); error.name = value; error.code = value; throw error;}
        if (mode === 'evidence') await browser.evidence('observation', {copy: value});
        if (mode === 'output') browser.output({name: 'copy', type: 'string', sensitivity: 'public', value});
        const proof = await browser.evidence('observation', {message: 'fixture observed'});
        browser.assertion({id: 'browser-checked', status: 'PASS', reliable: true, evidenceIds: [proof]});
      }),
      cleanup: mutates ? ctx => ctx.api.execute({operation: clean, invocationId: 'clean', inputs: [ctx.resource('row').outputs[0]], lifecycle: {resourceId: 'row'}}) : async () => {}
    }, {api: {storeSensitive: () => 'protected:classified'}});
  } finally {fs.writeFile = originalWrite; syncBuiltinESMExports();}
  assert.equal(result.status, mode === 'pass' ? 'PASS' : mode === 'write' ? 'NEEDS_REVIEW' : 'BLOCKED');
  assert.equal(mutations, mutates ? 1 : 0); assert.equal(cleanupCalls, mutates ? 1 : 0); assert.equal(present, false);
  assert.equal(existsSync(join(f.roots.runRoot, 'protected')), false);
  const scenario = result.scenarios[0], attempt = scenario.attempts.find(item => item.identity.invocationId === 'browser-case');
  assert.equal(scenario.requiredLifecycleComplete, true); assert.equal(attempt.effect.certainty, mutates ? 'confirmed' : 'none');
  assert.equal(attempt.outcome, mode === 'pass' ? 'SUCCESS' : 'INFRASTRUCTURE_FAILURE');
  if (mode !== 'pass') assert.equal(attempt.failureClass, 'EXECUTOR');
  if (mode === 'write') assert.equal(injected, true);
  if (!['OK', true, 'goto'].includes(value)) assert(!f.allText().includes(value));
  if (value === 'goto') {
    const events = result.evidence.filter(item => item.identity.attemptId === attempt.identity.attemptId)
      .flatMap(item => JSON.parse(readFileSync(join(f.roots.runRoot, item.path), 'utf8')).nativeEvents ?? []);
    assert(events.some(event => event.command === '[redacted]' && event.classification === 'OK' && event.dispatched));
  }
});
