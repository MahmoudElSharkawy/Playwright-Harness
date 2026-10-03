import {existsSync, mkdirSync, linkSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readBounded, writeJson, ownedFile} from './storage.mjs';
import {requireThat, data} from '../execution-core/data.mjs';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = value => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
export function controlDirectory(roots, executionId, runId) {return ownedFile(roots, executionId, `control/${runId}`);}
export class HostMailbox {
  constructor(directory, runId, channel) {
    this.directory = directory; this.runId = runId;
    for (const path of ['inbox', 'replies']) mkdirSync(join(directory, path), {recursive: true, mode: 0o700});
    this.state = {version: 1, runId, channel, nextSeq: 1, inFlight: null, state: 'STARTING'}; this.save();
  }
  save(patch = {}) {Object.assign(this.state, patch); writeJson(join(this.directory, 'host.json'), this.state);}
  take() {
    const file = join(this.directory, 'inbox', `${this.state.nextSeq}.json`);
    if (!existsSync(file)) return null;
    const request = readBounded(file, 128 * 1024);
    requireThat(request.runId === this.runId && request.channel === this.state.channel && request.seq === this.state.nextSeq && uuid(request.requestId), 'WRONG_RUN');
    requireThat(Array.isArray(request.args) && request.args.length && request.args.every(arg => typeof arg === 'string'), 'Malformed mailbox command.');
    this.save({inFlight: {seq: request.seq, requestId: request.requestId, cmd: request.args[0], startedAt: Date.now()}});
    const stored = join(this.directory, 'replies', `id-${request.requestId}.json`);
    return existsSync(stored) ? {...request, cached: readBounded(stored, 256 * 1024)} : request;
  }
  reply(request, result) {
    const reply = data({...result, runId: this.runId, seq: request.seq, requestId: request.requestId}, 256 * 1024);
    writeJson(join(this.directory, 'replies', `${request.seq}.json`), reply, {exclusive: true, maximum: 256 * 1024});
    const stored = join(this.directory, 'replies', `id-${request.requestId}.json`);
    if (!existsSync(stored)) writeJson(stored, reply, {exclusive: true, maximum: 256 * 1024});
    this.save({nextSeq: request.seq + 1, inFlight: null});
  }
}
/** Exclusive inbox publication plus durable request IDs prevents mutation re-dispatch. */
export async function sendCommand(directory, runId, args, {requestId = randomUUID(), awaitSeq, timeoutMs = 180000} = {}) {
  requireThat(uuid(requestId), 'Request id must be a UUID.');
  requireThat(awaitSeq === undefined || Number.isSafeInteger(awaitSeq) && awaitSeq > 0, 'Await needs a positive sequence number.');
  const hostFile = join(directory, 'host.json'); let host = readBounded(hostFile), seq = awaitSeq;
  requireThat(host.runId === runId, 'WRONG_RUN');
  const stored = join(directory, 'replies', `id-${requestId}.json`);
  if (existsSync(stored)) return readBounded(stored, 256 * 1024);
  // A reply is durable just before the host advances its sequence. Allow that
  // short transition to finish before treating a serial next command as busy.
  const settledAt = Date.now() + 1000;
  while (seq === undefined && host.inFlight && host.inFlight.requestId !== requestId && existsSync(join(directory, 'replies', `${host.inFlight.seq}.json`)) && Date.now() < settledAt) {await delay(10); host = readBounded(hostFile);}
  if (seq === undefined && host.inFlight) {
    if (host.inFlight.requestId === requestId) seq = host.inFlight.seq;
    else return {status: 'BUSY', runId, requestId, inFlight: host.inFlight};
  }
  if (seq === undefined) {
    requireThat(!['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state), 'Host has finished.');
    requireThat(Array.isArray(args) && args.length && args.every(arg => typeof arg === 'string'), 'Command needs string arguments.');
    seq = host.nextSeq;
    const request = data({seq, requestId, runId, channel: host.channel, args}, 128 * 1024), file = join(directory, 'inbox', `${seq}.json`), temporary = `${file}.${requestId}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(request), {flag: 'wx', mode: 0o600, flush: true}); linkSync(temporary, file);
    } catch (error) {if (error.code === 'EEXIST') return {status: 'BUSY', runId, requestId, seq}; throw error;}
    finally {if (existsSync(temporary)) unlinkSync(temporary);}
  }
  const replyFile = join(directory, 'replies', `${seq}.json`), deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(replyFile)) return readBounded(replyFile, 256 * 1024);
    host = readBounded(hostFile); if (['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state) && !host.inFlight) break;
    await delay(100);
  }
  return {status: 'REPLY_PENDING', runId, seq, requestId};
}
