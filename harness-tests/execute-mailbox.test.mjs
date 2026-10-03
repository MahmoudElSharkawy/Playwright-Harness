import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {executionFixture} from './fixtures/execute.mjs';
import {HostMailbox, sendCommand} from '../scripts/lib/execute/mailbox.mjs';
test('single-flight pending replies, await, run binding and UUID deduplication', async t => {
  const f = await executionFixture(t), directory = join(f.projectRoot, '.harness/mailbox'), box = new HostMailbox(directory, 'run1', 'channel1'), requestId = randomUUID(); box.save({state: 'READY'});
  const pending = await sendCommand(directory, 'run1', ['mutation'], {requestId, timeoutMs: 1}); assert.equal(pending.status, 'REPLY_PENDING');
  const request = box.take(); assert.equal((await sendCommand(directory, 'run1', ['other'], {timeoutMs: 1})).status, 'BUSY');
  box.reply(request, {status: 'OK', mutations: 1}); assert.equal((await sendCommand(directory, 'run1', [], {awaitSeq: 1})).mutations, 1);
  assert.equal((await sendCommand(directory, 'run1', ['mutation'], {requestId})).mutations, 1); assert.equal(box.take(), null);
  await assert.rejects(sendCommand(directory, 'run2', ['status']), /WRONG_RUN/);
});
