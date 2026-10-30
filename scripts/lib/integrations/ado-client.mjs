import {createHash} from 'node:crypto';
import {createDelivery, requestFingerprint} from './delivery.mjs';
import {validateAdoConfiguration, requireValue, adoGuid} from './config.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export const adoRequestFingerprint = requestFingerprint;
export class AdoError extends Error {
  constructor(code, status) { super(`ADO ${code}${status ? ` (HTTP ${status})` : ''}.`); this.code = code; this.status = status; }
}

/** ADO transport only; no application executor or host dependency. No write retries. */
export function createAdoClient({configuration, roots, resolveCredential, fetchImpl = fetch}) {
  const config = validateAdoConfiguration(configuration);
  const base = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/`;
  function destination(route, projectLookup = false, teamLookup = false) {
    const scopedBase = projectLookup || teamLookup ? `${config.organizationUrl}/_apis/` : base;
    if (projectLookup) requireValue(route === `projects/${encodeURIComponent(config.project)}?api-version=7.1`, 'Only the configured project identity can be resolved at collection scope.');
    if (teamLookup) {
      const match = /^projects\/([a-f0-9-]{36})\/teams(?:\/([a-f0-9-]{36})\/members)?\?api-version=7\.1&\$skip=\d+&\$top=100$/i.exec(route);
      requireValue(match && identity && match[1].toLowerCase() === identity.id.toLowerCase() && (!match[2] || adoGuid(match[2])), 'Only configured-project teams and members can be read at collection scope.');
    }
    requireValue(typeof route === 'string' && /^[A-Za-z]/.test(route) && !/[\\#\x00-\x20]/.test(route), 'Invalid ADO relative route.');
    const url = new URL(route, scopedBase), decoded = decodeURIComponent(url.pathname);
    requireValue(url.href.startsWith(scopedBase) && !decoded.includes('..') && !url.username && !url.password, 'ADO route escapes the configured project.');
    return url.href;
  }
  async function request(route, {method = 'GET', body, patch = false, raw = false, binary = false, contentType, beforeDispatch, projectLookup = false, teamLookup = false} = {}) {
    requireValue(!(projectLookup || teamLookup) || method === 'GET', 'Project identity and team lookup are read-only.');
    requireValue(!raw || Buffer.isBuffer(body) && contentType === 'application/octet-stream', 'Raw ADO bodies require bounded attachment bytes.');
    const url = destination(route, projectLookup, teamLookup), serialized = body === undefined ? undefined : raw ? body : JSON.stringify(body);
    requireValue(serialized === undefined || Buffer.byteLength(serialized) <= (raw ? config.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024 : config.maxResponseBytes), 'ADO request exceeds configured bound.');
    let credential; try { credential = await resolveCredential(); } catch { throw new AdoError('credential-unresolved'); }
    requireValue(typeof credential === 'string' && credential.length > 0 && !/[\r\n]/.test(credential), 'ADO credential reference is unresolved.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      beforeDispatch?.();
      response = await fetchImpl(url, {method, redirect: 'manual', signal: controller.signal,
        headers: {Authorization: `Basic ${Buffer.from(`:${credential}`).toString('base64')}`, Accept: binary ? 'application/octet-stream' : 'application/json', 'Content-Type': raw ? contentType : patch ? 'application/json-patch+json' : 'application/json'}, body: serialized});
      if (response.status === 203 || [401, 403].includes(response.status)) throw new AdoError('authentication-rejected', response.status);
      if (response.status >= 300 && response.status < 400) throw new AdoError('redirect-refused', response.status);
      if (!response.ok) throw new AdoError('request-rejected', response.status);
      if (Number(response.headers.get('content-length')) > config.maxResponseBytes) throw new AdoError('response-too-large');
      const chunks = []; let length = 0;
      for await (const chunk of response.body ?? []) {
        length += chunk.length; if (length > config.maxResponseBytes) throw new AdoError('response-too-large'); chunks.push(chunk);
      }
      if (binary) return {data: Buffer.concat(chunks)};
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
  async function list(route, pagination = 'continuation', teamLookup = false) {
    const values = [], seen = new Set(); let continuation, skip = 0;
    for (let page = 0; page < 100; page++) {
      const extra = pagination === 'offset' ? `&$skip=${skip}&$top=100` : continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : '';
      const result = await request(`${route}${extra}`, {teamLookup}), rows = result.data.value ?? (Array.isArray(result.data) ? result.data : undefined);
      requireValue(Array.isArray(rows), 'ADO list response is incomplete.');
      if (teamLookup) requireValue(rows.length <= 100 && (result.data.count === undefined || result.data.count === rows.length), 'ADO team page is incomplete or exceeds its bound.');
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
    const valid = value => (Number.isSafeInteger(value) && value > 0) || adoGuid(value);
    return createDelivery({roots, provider: 'ADO', kind, execute, sourceFingerprint, base, destination,
      methods: ['PATCH', 'POST'], validIdentity: valid, validVerified: value => Number.isSafeInteger(value) && value > 0,
      isRemoteError: error => error instanceof AdoError, send: async (route, options) => (await request(route, options)).data,
      identityFor(operation, data) {
        const key = {'create-run': 'runId', 'create-bug': 'workItemId', 'create-case': 'workItemId', 'upload-attachment': 'attachmentId', 'create-pull-request': 'pullRequestId', 'create-comment': 'commentId'}[operation];
        const value = key === 'pullRequestId' ? data?.pullRequestId : key === 'commentId' ? data?.id ?? data?.commentId : data?.id;
        return key && valid(value) ? {[key]: value} : undefined;
      }});
  }
  const cache = new Map();
  const cached = (key, action) => {if (!cache.has(key)) {const pending = Promise.resolve().then(action); cache.set(key, pending); pending.catch(() => {if (cache.get(key) === pending) cache.delete(key);});} return cache.get(key);};
  return Object.freeze({configuration: config, read, list, delivery, projectIdentity, requireWorkItemProject,
    async projectTeams() {const project = await projectIdentity(); return list(`projects/${project.id}/teams?api-version=7.1`, 'offset', true);},
    async teamMembers(teamId) {requireValue(adoGuid(teamId), 'Invalid ADO team identity.'); const project = await projectIdentity(); return list(`projects/${project.id}/teams/${teamId}/members?api-version=7.1`, 'offset', true);},
    cachedRead: route => cached(`read:${route}`, () => read(route)),
    async wiql(query, {top} = {}) {
      // Keywords in quoted field values are data, including localized area names.
      const statement = typeof query === 'string' ? query.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, '') : '';
      requireValue(typeof query === 'string' && query.length <= 16000 && /^SELECT\s+/i.test(query) && !/['";]|\b(?:INSERT|UPDATE|DELETE|DROP)\b/i.test(statement), 'WIQL must be a bounded read-only SELECT.');
      requireValue(top === undefined || Number.isInteger(top) && top > 0 && top <= 20000, 'Invalid WIQL page bound.');
      return (await request(`wit/wiql?api-version=7.1${top === undefined ? '' : `&$top=${top}`}`, {method: 'POST', body: {query}})).data;
    },
    async attachment(id) {requireValue(adoGuid(id), 'Invalid ADO attachment identity.'); return (await request(`wit/attachments/${encodeURIComponent(id)}?api-version=7.1`, {binary: true})).data;},
    validateWorkItem(type, body, {fresh = false} = {}) {requireValue(typeof type === 'string' && type.trim() && type.length <= 150 && !/[\/\\?#\r\n]/.test(type), 'Invalid work-item type.'); const validate = async () => (await request(`wit/workitems/$${encodeURIComponent(type)}?validateOnly=true&api-version=7.1`, {method: 'POST', body, patch: true})).data; return fresh ? validate() : cached(`validate:${type}:${digest(JSON.stringify(body))}`, validate);},
    validateWorkItemUpdate(id, body) {requireValue(Number.isSafeInteger(id) && id > 0 && id <= 2147483647, 'Invalid work-item identity.'); return request(`wit/workitems/${id}?validateOnly=true&api-version=7.1`, {method: 'PATCH', body, patch: true}).then(result => result.data);},
    upload(delivery, bytes, name, options = {}) {requireValue(typeof name === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(name), 'Invalid attachment name.'); return delivery.write('upload-attachment', `wit/attachments?fileName=${encodeURIComponent(name)}&api-version=7.1`, bytes, {method: 'POST', raw: true, contentType: 'application/octet-stream', ...options});},
    // This POST has a documented read-only contract; callers cannot select a mutation route.
    async workItems(ids, fields) {requireValue(Array.isArray(ids) && ids.length > 0 && ids.length <= 200, 'ADO work-item batches require 1–200 IDs.'); return (await request('wit/workitemsbatch?api-version=7.1', {method: 'POST', body: {ids, fields, errorPolicy: 'fail'}})).data;}
  });
}
