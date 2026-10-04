import {mkdirSync, openSync, writeSync, fsyncSync, closeSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {consumerPath} from '../consumer-paths.mjs';
import {validateAdoConfiguration, requireValue, adoGuid} from './config.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export const adoRequestFingerprint = (route, method, body, raw = false) => digest(JSON.stringify({route, method, body: raw ? digest(body) : body}));
export class AdoError extends Error {
  constructor(code, status) { super(`ADO ${code}${status ? ` (HTTP ${status})` : ''}.`); this.code = code; this.status = status; }
}

/** ADO transport only; no application executor or host dependency. No write retries. */
export function createAdoClient({configuration, roots, resolveCredential, fetchImpl = fetch}) {
  const config = validateAdoConfiguration(configuration);
  const base = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/`;
  function destination(route, projectLookup = false) {
    const scopedBase = projectLookup ? `${config.organizationUrl}/_apis/` : base;
    if (projectLookup) requireValue(route === `projects/${encodeURIComponent(config.project)}?api-version=7.1`, 'Only the configured project identity can be resolved at collection scope.');
    requireValue(typeof route === 'string' && /^[A-Za-z]/.test(route) && !/[\\#\x00-\x20]/.test(route), 'Invalid ADO relative route.');
    const url = new URL(route, scopedBase), decoded = decodeURIComponent(url.pathname);
    requireValue(url.href.startsWith(scopedBase) && !decoded.includes('..') && !url.username && !url.password, 'ADO route escapes the configured project.');
    return url.href;
  }
  async function request(route, {method = 'GET', body, patch = false, raw = false, contentType, beforeDispatch, projectLookup = false} = {}) {
    requireValue(!projectLookup || method === 'GET', 'Project identity lookup is read-only.');
    requireValue(!raw || Buffer.isBuffer(body) && contentType === 'application/octet-stream', 'Raw ADO bodies require bounded attachment bytes.');
    const url = destination(route, projectLookup), serialized = body === undefined ? undefined : raw ? body : JSON.stringify(body);
    requireValue(serialized === undefined || Buffer.byteLength(serialized) <= (raw ? config.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024 : config.maxResponseBytes), 'ADO request exceeds configured bound.');
    let credential; try { credential = await resolveCredential(); } catch { throw new AdoError('credential-unresolved'); }
    requireValue(typeof credential === 'string' && credential.length > 0 && !/[\r\n]/.test(credential), 'ADO credential reference is unresolved.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      beforeDispatch?.();
      response = await fetchImpl(url, {method, redirect: 'manual', signal: controller.signal,
        headers: {Authorization: `Basic ${Buffer.from(`:${credential}`).toString('base64')}`, Accept: 'application/json', 'Content-Type': raw ? contentType : patch ? 'application/json-patch+json' : 'application/json'}, body: serialized});
      if (response.status === 203 || [401, 403].includes(response.status)) throw new AdoError('authentication-rejected', response.status);
      if (response.status >= 300 && response.status < 400) throw new AdoError('redirect-refused', response.status);
      if (!response.ok) throw new AdoError('request-rejected', response.status);
      if (Number(response.headers.get('content-length')) > config.maxResponseBytes) throw new AdoError('response-too-large');
      const chunks = []; let length = 0;
      for await (const chunk of response.body ?? []) {
        length += chunk.length; if (length > config.maxResponseBytes) throw new AdoError('response-too-large'); chunks.push(chunk);
      }
      let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AdoError('invalid-json'); }
      if (!data || typeof data !== 'object') throw new AdoError('invalid-json');
      return {data, continuation: response.headers.get('x-ms-continuationtoken') || undefined};
    } catch (error) {
      if (error instanceof AdoError) throw error;
      throw new AdoError(controller.signal.aborted ? 'timeout' : 'transport-failure');
    } finally { clearTimeout(timer); if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {}); }
  }
  async function read(route) { return (await request(route)).data; }
  let identity;
  async function projectIdentity() {
    if (!identity) {
      const {data} = await request(`projects/${encodeURIComponent(config.project)}?api-version=7.1`, {projectLookup: true});
      requireValue(adoGuid(data.id) && typeof data.name === 'string' && data.name.trim() && [data.id, data.name].some(value => value.toLowerCase() === config.project.toLowerCase()), 'ADO project identity does not match configuration.');
      identity = Object.freeze({id: data.id, name: data.name});
    }
    return identity;
  }
  async function requireWorkItemProject(item) {
    const project = await projectIdentity(), name = item?.fields?.['System.TeamProject'];
    requireValue(typeof name === 'string' && name.toLowerCase() === project.name.toLowerCase(), 'ADO work item has missing or mismatched project ownership.');
  }
  async function list(route, pagination = 'continuation') {
    const values = [], seen = new Set(); let continuation, skip = 0;
    for (let page = 0; page < 100; page++) {
      const extra = pagination === 'offset' ? `&$skip=${skip}&$top=100` : continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : '';
      const result = await request(`${route}${extra}`), rows = result.data.value ?? (Array.isArray(result.data) ? result.data : undefined);
      requireValue(Array.isArray(rows), 'ADO list response is incomplete.');
      values.push(...rows); requireValue(values.length <= 10000, 'ADO list exceeds bounded scope.');
      if (pagination === 'offset') {
        if (rows.length === 0) return values;
        const key = digest(JSON.stringify(rows)); requireValue(!seen.has(key), 'ADO pagination did not advance.'); seen.add(key); skip += rows.length;
      } else {
        continuation = result.continuation; if (!continuation) return values;
        requireValue(!seen.has(continuation) && continuation.length <= 2048, 'ADO continuation did not advance.'); seen.add(continuation);
      }
    }
    throw new Error('ADO pagination exceeds 100 pages.');
  }
  function delivery(kind, execute, sourceFingerprint) {
    requireValue(execute === true, 'External ADO writes require explicit execution authorization.');
    requireValue(['outcomes', 'automation', 'tags', 'relations', 'pull-request', 'bugs'].includes(kind), 'Unknown ADO delivery kind.');
    const id = randomUUID(), receipt = `.harness/state/integrations/${id}.jsonl`;
    const file = consumerPath(roots, receipt); mkdirSync(dirname(file), {recursive: true});
    // Recheck after mkdir and use exclusive creation; each event is flushed before dispatch.
    const fd = openSync(consumerPath(roots, receipt), 'wx', 0o600); closeSync(fd);
    function record(event) {
      const descriptor = openSync(consumerPath(roots, receipt), 'a');
      try { writeSync(descriptor, JSON.stringify({deliveryId: id, at: new Date().toISOString(), ...event}) + '\n'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
    requireValue(sourceFingerprint === undefined || /^[a-f0-9]{64}$/.test(sourceFingerprint), 'Invalid publication fingerprint.');
    record({event: 'authorized', kind, destinationFingerprint: digest(base), ...(sourceFingerprint ? {sourceFingerprint} : {})});
    let stopped = false;
    return Object.freeze({id, receipt,
      async write(operation, route, body, {method = 'PATCH', patch = false, raw = false, contentType, onIdentity} = {}) {
        requireValue(!stopped && ['PATCH', 'POST'].includes(method), 'ADO delivery is stopped or method unsupported.');
        requireValue(/^[a-z-]+$/.test(operation), 'Invalid ADO operation label.');
        destination(route); const requestFingerprint = adoRequestFingerprint(route, method, body, raw); let dispatched = false;
        record({event: 'prepared', operation, requestFingerprint}); let data, identity;
        try {
          const result = await request(route, {method, body, patch, raw, contentType, beforeDispatch() {record({event: 'dispatching', operation, requestFingerprint, effect: 'uncertain'}); dispatched = true;}});
          const key = {'create-run': 'runId', 'create-bug': 'workItemId', 'upload-attachment': 'attachmentId', 'create-pull-request': 'pullRequestId'}[operation], value = key === 'pullRequestId' ? result.data.pullRequestId : result.data.id;
          identity = key && ((Number.isSafeInteger(value) && value > 0) || adoGuid(value)) ? {[key]: value} : undefined;
          record({event: 'acknowledged', operation, requestFingerprint, effect: 'confirmed', ...(identity ? {identity} : {})});
          data = result.data;
        } catch (error) {
          stopped = true;
          record({event: 'incomplete', operation, requestFingerprint, effect: dispatched ? 'uncertain' : 'not-executed', code: error instanceof AdoError ? error.code : 'local-failure'});
          throw new Error(`ADO delivery incomplete; inspect receipt ${receipt}. No automatic replay.`);
        }
        // The acknowledgement is durable. A local callback failure must not rewrite a confirmed effect as uncertain.
        if (identity) await onIdentity?.(identity); return data;
      },
      verified(identity) {
        requireValue(!stopped && identity && Object.values(identity).every(value => Number.isSafeInteger(value) && value > 0), 'Invalid ADO verification identity.');
        record({event: 'verified', identity});
      },
      identified(identity) {
        requireValue(!stopped && identity && Object.values(identity).every(value => (Number.isSafeInteger(value) && value > 0) || adoGuid(value)), 'Invalid ADO response identity.');
        record({event: 'identified', identity});
      },
      finish() { requireValue(!stopped, 'Cannot complete a stopped ADO delivery.'); record({event: 'completed'}); stopped = true; return {mode: 'execute', receipt}; },
      incomplete() { stopped = true; record({event: 'verification-incomplete'}); return new Error(`ADO verification incomplete; inspect receipt ${receipt}. Reconcile before another delivery.`); }
    });
  }
  const cache = new Map();
  const cached = (key, action) => {if (!cache.has(key)) {const pending = Promise.resolve().then(action); cache.set(key, pending); pending.catch(() => {if (cache.get(key) === pending) cache.delete(key);});} return cache.get(key);};
  return Object.freeze({configuration: config, read, list, delivery, projectIdentity, requireWorkItemProject,
    cachedRead: route => cached(`read:${route}`, () => read(route)),
    async wiql(query) {
      requireValue(typeof query === 'string' && query.length <= 16000 && /^SELECT\s+/i.test(query) && !/;|\b(?:INSERT|UPDATE|DELETE|DROP)\b/i.test(query), 'WIQL must be a bounded read-only SELECT.');
      return (await request('wit/wiql?api-version=7.1', {method: 'POST', body: {query}})).data;
    },
    validateWorkItem(type, body) {requireValue(typeof type === 'string' && type.trim() && type.length <= 150 && !/[\/\\?#\r\n]/.test(type), 'Invalid bug work-item type.'); return cached(`validate:${type}:${digest(JSON.stringify(body))}`, async () => (await request(`wit/workitems/$${encodeURIComponent(type)}?validateOnly=true&api-version=7.1`, {method: 'POST', body, patch: true})).data);},
    upload(delivery, bytes, name, options = {}) {requireValue(typeof name === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(name), 'Invalid attachment name.'); return delivery.write('upload-attachment', `wit/attachments?fileName=${encodeURIComponent(name)}&api-version=7.1`, bytes, {method: 'POST', raw: true, contentType: 'application/octet-stream', ...options});},
    // This POST has a documented read-only contract; callers cannot select a mutation route.
    async workItems(ids, fields) {requireValue(Array.isArray(ids) && ids.length > 0 && ids.length <= 200, 'ADO work-item batches require 1–200 IDs.'); return (await request('wit/workitemsbatch?api-version=7.1', {method: 'POST', body: {ids, fields, errorPolicy: 'fail'}})).data;}
  });
}
