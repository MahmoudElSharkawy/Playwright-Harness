import {mkdirSync, openSync, writeSync, fsyncSync, closeSync, readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {consumerPath} from '../consumer-paths.mjs';
import {requireValue} from './config.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export const requestFingerprint = (route, method, body, raw = false) => digest(JSON.stringify({route, method, body: raw ? digest(body) : body}));
export const externalIdentity = value => (Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value));

/** Read all receipts for one approved operation before resuming a proven missing write. */
export function deliveryProgress(roots, receipts, {sourceFingerprint, kind}) {
  requireValue(Array.isArray(receipts) && receipts.length > 0 && receipts.length <= 100 && new Set(receipts).size === receipts.length, 'Recovery needs distinct bounded delivery receipts.');
  const progress = new Map();
  for (const receipt of receipts) {
    requireValue(/^\.harness\/state\/integrations\/[a-f0-9-]{36}\.jsonl$/.test(receipt), 'Recovery receipt is outside integration storage.');
    const text = readFileSync(consumerPath(roots, receipt), 'utf8'); requireValue(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Recovery receipt exceeds its bound.');
    const events = text.trim().split('\n').map(line => JSON.parse(line)), first = events[0];
    requireValue(first?.event === 'authorized' && first.kind === kind && first.sourceFingerprint === sourceFingerprint, 'Recovery receipt differs from the approved operation.');
    for (const event of events.slice(1)) {
      requireValue(event.deliveryId === first.deliveryId, 'Recovery receipt contains another delivery identity.');
      if (!event.requestFingerprint) continue;
      requireValue(/^[a-f0-9]{64}$/.test(event.requestFingerprint), 'Recovery request identity is invalid.');
      const old = progress.get(event.requestFingerprint) ?? {dispatched: false, confirmed: false};
      if (event.event === 'dispatching') {old.dispatched = true; old.rejected = false;}
      if (event.event === 'acknowledged') old.confirmed = true;
      if (event.event === 'incomplete' && event.effect === 'not-executed') old.rejected = true;
      progress.set(event.requestFingerprint, old);
    }
  }
  return progress;
}

export function requireUndispatched(requests, progress) {
  for (const request of requests) {
    const route = request.channel ? `${request.channel}/${request.route}` : request.route, prior = progress.get(requestFingerprint(route, request.method, request.body));
    requireValue(!prior || !prior.confirmed && (!prior.dispatched || prior.rejected), 'A missing remote effect was already dispatched; preserve uncertainty instead of repeating it.');
  }
  return requests;
}

/** One durable write protocol for every provider. Native adapters supply transport and identity decoding. */
export function createDelivery({roots, provider, kind, execute, sourceFingerprint, base, destination, send,
  identityFor, validIdentity = externalIdentity, validVerified = validIdentity, methods = ['POST', 'PATCH', 'PUT', 'DELETE'], isRemoteError = () => false}) {
  requireValue(execute === true, `External ${provider} writes require explicit execution authorization.`);
  requireValue(['outcomes', 'automation', 'tags', 'relations', 'pull-request', 'bugs', 'case-edits', 'case-design', 'story-comment'].includes(kind), `Unknown ${provider} delivery kind.`);
  requireValue(sourceFingerprint === undefined || /^[a-f0-9]{64}$/.test(sourceFingerprint), 'Invalid publication fingerprint.');
  const id = randomUUID(), receipt = `.harness/state/integrations/${id}.jsonl`;
  mkdirSync(dirname(consumerPath(roots, receipt)), {recursive: true});
  const fd = openSync(consumerPath(roots, receipt), 'wx', 0o600); closeSync(fd);
  function record(event) {
    const descriptor = openSync(consumerPath(roots, receipt), 'a');
    try {writeSync(descriptor, JSON.stringify({deliveryId: id, at: new Date().toISOString(), ...event}) + '\n'); fsyncSync(descriptor);} finally {closeSync(descriptor);}
  }
  record({event: 'authorized', kind, destinationFingerprint: digest(base), ...(sourceFingerprint ? {sourceFingerprint} : {})});
  let stopped = false;
  return Object.freeze({id, receipt,
    async write(operation, route, body, {method = 'PATCH', patch = false, raw = false, contentType, onIdentity} = {}) {
      requireValue(!stopped && methods.includes(method), `${provider} delivery is stopped or method unsupported.`);
      requireValue(/^[a-z-]+$/.test(operation), `Invalid ${provider} operation label.`);
      destination(route); const fingerprint = requestFingerprint(route, method, body, raw); let dispatched = false, data, identity;
      record({event: 'prepared', operation, requestFingerprint: fingerprint});
      try {
        data = await send(route, {method, body, patch, raw, contentType, beforeDispatch() {record({event: 'dispatching', operation, requestFingerprint: fingerprint, effect: 'uncertain'}); dispatched = true;}});
        identity = identityFor?.(operation, data);
        requireValue(identity === undefined || identity && Object.values(identity).every(validIdentity), 'Invalid response identity.');
        record({event: 'acknowledged', operation, requestFingerprint: fingerprint, effect: 'confirmed', ...(identity ? {identity} : {})});
      } catch (error) {
        stopped = true;
        const remote = isRemoteError(error), rejected = remote && [400, 401, 403, 404, 409, 412, 413, 415, 422].includes(error.status);
        const effect = dispatched && !rejected ? 'uncertain' : 'not-executed';
        record({event: 'incomplete', operation, requestFingerprint: fingerprint, effect, code: remote ? error.code : 'local-failure'});
        throw Object.assign(new Error(`${provider} delivery incomplete; inspect receipt ${receipt}. No automatic replay.`), {delivery: {effect}});
      }
      // A local callback failure cannot erase an acknowledged remote effect.
      if (identity) await onIdentity?.(identity); return data;
    },
    verified(identity) {requireValue(!stopped && identity && Object.values(identity).every(validVerified), `Invalid ${provider} verification identity.`); record({event: 'verified', identity});},
    identified(identity) {requireValue(!stopped && identity && Object.values(identity).every(validIdentity), `Invalid ${provider} response identity.`); record({event: 'identified', identity});},
    finish() {requireValue(!stopped, `Cannot complete a stopped ${provider} delivery.`); record({event: 'completed'}); stopped = true; return {mode: 'execute', receipt};},
    incomplete() {stopped = true; record({event: 'verification-incomplete'}); return new Error(`${provider} verification incomplete; inspect receipt ${receipt}. Reconcile before another delivery.`);}
  });
}
