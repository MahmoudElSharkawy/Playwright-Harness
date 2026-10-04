import {existsSync, mkdirSync, linkSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readBounded, readOptional, writeJson, ownedFile, publishExclusive} from './storage.mjs';
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
  save(patch = {}) {const candidate = {...this.state, ...patch}; writeJson(join(this.directory, 'host.json'), candidate); this.state = candidate;}
  take() {
    const file = join(this.directory, 'inbox', `${this.state.nextSeq}.json`);
    const request = readOptional(file, 128 * 1024); if (!request) return null;
    requireThat(request.runId === this.runId && request.channel === this.state.channel && request.seq === this.state.nextSeq && uuid(request.requestId), 'WRONG_RUN');
    requireThat(Array.isArray(request.args) && request.args.length && request.args.every(arg => typeof arg === 'string'), 'Malformed mailbox command.');
    this.save({inFlight: {seq: request.seq, requestId: request.requestId, cmd: request.args[0], startedAt: Date.now()}});
    const stored = join(this.directory, 'replies', `id-${request.requestId}.json`);
    const cached = readOptional(stored, 256 * 1024); return cached ? {...request, cached} : request;
  }
  reply(request, result) {
    const reply = data({...result, runId: this.runId, seq: request.seq, requestId: request.requestId}, 256 * 1024);
    const stored = join(this.directory, 'replies', `id-${request.requestId}.json`);
    if (!readOptional(stored, 256 * 1024)) writeJson(stored, reply, {exclusive: true, maximum: 256 * 1024, compact: true});
    try {linkSync(stored, join(this.directory, 'replies', `${request.seq}.json`));} catch (error) {if (error.code !== 'EEXIST') throw error;}
    this.save({nextSeq: request.seq + 1, inFlight: null});
    try {unlinkSync(join(this.directory, 'inbox', `${request.seq}.json`));} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
}
/** Exclusive inbox publication plus durable request IDs prevents mutation re-dispatch. */
export async function sendCommand(directory, runId, args, options = {}) {
  let requestId = options.requestId ?? randomUUID(); requireThat(uuid(requestId), 'Request id must be a UUID.');
  try {
    if (options.awaitSeq !== undefined && options.requestId === undefined) {const host = readBounded(join(directory, 'host.json')); if (host.inFlight?.seq === options.awaitSeq) requestId = host.inFlight.requestId;}
    return await send(directory, runId, args, {...options, requestId});
  } catch (error) {throw Object.assign(error, {requestId});}
}
async function send(directory, runId, args, {requestId, awaitSeq, timeoutMs = 180000}) {
  requireThat(uuid(requestId), 'Request id must be a UUID.');
  requireThat(awaitSeq === undefined || Number.isSafeInteger(awaitSeq) && awaitSeq > 0, 'Await needs a positive sequence number.');
  const hostFile = join(directory, 'host.json'); let host = readBounded(hostFile), seq = awaitSeq;
  requireThat(host.runId === runId, 'WRONG_RUN');
  const stored = join(directory, 'replies', `id-${requestId}.json`);
  const cached = readOptional(stored, 256 * 1024); if (cached) return cached;
  // A reply is durable just before the host advances its sequence. Allow that
  // short transition to finish before treating a serial next command as busy.
  const settledAt = performance.now() + 1000;
  while (seq === undefined && host.inFlight && host.inFlight.requestId !== requestId && existsSync(join(directory, 'replies', `${host.inFlight.seq}.json`)) && performance.now() < settledAt) {await delay(10); host = readBounded(hostFile);}
  if (seq === undefined && host.inFlight) {
    if (host.inFlight.requestId === requestId) seq = host.inFlight.seq;
    else return {status: 'BUSY', runId, requestId, inFlight: host.inFlight};
  }
  if (seq === undefined) {
    requireThat(!['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state), 'Host has finished.');
    requireThat(Array.isArray(args) && args.length && args.every(arg => typeof arg === 'string'), 'Command needs string arguments.');
    seq = host.nextSeq;
    const request = data({seq, requestId, runId, channel: host.channel, args}, 128 * 1024), file = join(directory, 'inbox', `${seq}.json`);
    try {
      publishExclusive(file, JSON.stringify(request));
    } catch (error) {if (error.code === 'EEXIST') return {status: 'BUSY', runId, requestId, seq}; throw Object.assign(error, {requestId, seq});}
  }
  const replyFile = join(directory, 'replies', `${seq}.json`), deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const reply = readOptional(replyFile, 256 * 1024); if (reply) return reply;
    host = readBounded(hostFile);
    if (['FINISHED', 'INTERRUPTED', 'INTEGRITY_FAILURE'].includes(host.state)) {
      const receipt = readOptional(stored, 256 * 1024); if (receipt) return receipt;
      if (host.inFlight?.requestId === requestId) return {status: 'COMMAND_UNCERTAIN', runId, seq, requestId, reason: 'Host ended without a durable command receipt. Do not replay a possible mutation.'};
      break;
    }
    await delay(100);
  }
  return {status: 'REPLY_PENDING', runId, seq, requestId};
}
