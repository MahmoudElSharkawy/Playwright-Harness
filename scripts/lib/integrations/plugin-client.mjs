import {setTimeout as delay} from 'node:timers/promises';
import {requireValue} from './config.mjs';

export class PluginError extends Error {
  constructor(provider, code, status) {super(`${provider} ${code}${status ? ` (HTTP ${status})` : ''}.`); this.code = code; this.status = status;}
}

/** Fixed Cloud endpoints, independent plugin secrets, bounded reads, no mutation retries. */
export function createPluginClient({jira, resolveCredentials, fetchImpl = fetch}) {
  const config = jira.configuration, provider = config.testManagement.provider;
  requireValue(['xray', 'zephyr-scale'].includes(provider), 'Select a native test-management provider.');
  const base = provider === 'xray' ? 'https://xray.cloud.getxray.app/api/v2/' : `https://${config.testManagement.region === 'eu' ? 'eu.' : ''}api.zephyrscale.smartbear.com/v2/`;
  const timeoutMs = config.timeoutMs ?? 30000, maxResponseBytes = config.maxResponseBytes ?? 2 * 1024 * 1024;
  function destination(route) {
    requireValue(typeof route === 'string' && route.length <= 20000 && /^[A-Za-z]/.test(route) && !/[\\#\x00-\x20]/.test(route), 'Invalid test-management route.');
    let decoded = route; try {for (let round = 0; round < 5 && decoded.includes('%'); round++) decoded = decodeURIComponent(decoded);} catch {throw new Error('Invalid test-management route encoding.');}
    const url = new URL(route, base);
    requireValue(url.href.startsWith(base) && !decoded.includes('..') && !/[\\#]/.test(decoded) && !decoded.includes('://') && !url.username && !url.password, 'Test-management route escapes its destination.');
    requireValue(provider !== 'xray' || ['graphql', 'authenticate'].includes(route), 'Unsupported Xray route.');
    return url.href;
  }
  async function send(route, {method = 'GET', body, authorization, beforeDispatch, scalar = false, readOnly = false} = {}) {
    const url = destination(route), serialized = body === undefined ? undefined : JSON.stringify(body);
    requireValue(serialized === undefined || Buffer.byteLength(serialized) <= maxResponseBytes, 'Test-management request exceeds its bound.');
    const controller = new AbortController(), deadline = Date.now() + timeoutMs, timer = setTimeout(() => controller.abort(), timeoutMs); let response;
    try {
      for (let attempt = 0; ; attempt++) {
        beforeDispatch?.();
        response = await fetchImpl(url, {method, body: serialized, redirect: 'manual', signal: controller.signal,
          headers: {Accept: 'application/json', 'Content-Type': 'application/json', ...(authorization ? {Authorization: `Bearer ${authorization}`} : {})}});
        if (response.status >= 300 && response.status < 400) throw new PluginError(provider, 'redirect-refused', response.status);
        if ([401, 403].includes(response.status)) throw new PluginError(provider, response.status === 401 ? 'authentication-rejected' : 'permission-denied', response.status);
        if (response.status === 429 || response.status >= 500) {
          const header = response.headers.get('retry-after'), number = header === null ? NaN : Number(header);
          const wait = header === null ? 250 * 2 ** attempt : Number.isFinite(number) && number >= 0 ? number * 1000 : Math.max(0, Date.parse(header) - Date.now());
          if (method !== 'GET' && !readOnly || attempt >= 2 || !Number.isFinite(wait) || wait >= deadline - Date.now()) throw new PluginError(provider, response.status === 429 ? 'rate-limited' : 'service-unavailable', response.status);
          await response.body?.cancel().catch(() => {}); response = undefined; await delay(wait, undefined, {signal: controller.signal}); continue;
        }
        if (!response.ok) throw new PluginError(provider, 'request-rejected', response.status);
        if (response.status === 204) return undefined;
        if (Number(response.headers.get('content-length')) > maxResponseBytes) throw new PluginError(provider, 'response-too-large');
        let length = 0; const chunks = [];
        for await (const chunk of response.body ?? []) {length += chunk.length; if (length > maxResponseBytes) throw new PluginError(provider, 'response-too-large'); chunks.push(chunk);}
        let value; try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new PluginError(provider, 'invalid-json');}
        if (scalar ? typeof value !== 'string' || !value || /[\r\n]/.test(value) : !value || typeof value !== 'object') throw new PluginError(provider, 'invalid-json');
        if (route === 'graphql') {
          if (value.errors?.length || !value.data || typeof value.data !== 'object') throw new PluginError(provider, 'graphql-rejected', response.status);
          return value.data;
        }
        return value;
      }
    } catch (error) {
      if (error instanceof PluginError) throw error;
      throw new PluginError(provider, controller.signal.aborted ? 'timeout' : 'transport-failure');
    } finally {clearTimeout(timer); if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});}
  }
  let token;
  async function credential() {
    if (!token) token = Promise.resolve().then(async () => {
      let values; try {values = await resolveCredentials();} catch {throw new PluginError(provider, 'credential-unresolved');}
      const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 20000 && !/[\r\n]/.test(value);
      if (provider === 'zephyr-scale') {requireValue(valid(values?.token), 'Zephyr credential reference is unresolved.'); return values.token;}
      requireValue(valid(values?.clientId) && valid(values?.clientSecret), 'Xray credential references are unresolved.');
      return send('authenticate', {method: 'POST', body: {client_id: values.clientId, client_secret: values.clientSecret}, scalar: true});
    }).catch(error => {token = undefined; throw error;});
    return token;
  }
  async function request(route, options = {}) {
    destination(route); const method = options.method ?? 'GET';
    requireValue(['GET', 'POST', 'PUT', 'DELETE'].includes(method), 'Unsupported plugin request method.');
    requireValue(method === 'GET' || options.execute === true, 'Plugin writes require explicit execution authorization.');
    await jira.projectIdentity(); return send(route, {method, body: options.body, beforeDispatch: options.beforeDispatch, authorization: await credential()});
  }
  async function query(query, variables = {}) {
    requireValue(provider === 'xray' && typeof query === 'string' && /^\s*query\b/.test(query) && !/\bmutation\b/.test(query.replace(/"(?:[^"\\]|\\.)*"/g, '')), 'Only a bounded read-only Xray query is accepted.');
    await jira.projectIdentity(); return send('graphql', {method: 'POST', body: {query, variables}, readOnly: true, authorization: await credential()});
  }
  const read = route => request(route);
  async function list(route, {maxItems = 10000, pageSize = 100} = {}) {
    destination(route); requireValue(Number.isInteger(maxItems) && maxItems > 0 && maxItems <= 10000 && Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 100, 'Invalid plugin pagination bound.');
    const all = [], seen = new Set(); let startAt = 0;
    for (let page = 0; page < 100; page++) {
      const url = new URL(destination(route)); url.searchParams.set('startAt', String(startAt)); url.searchParams.set('maxResults', String(pageSize));
      const value = await read(url.href.slice(base.length)), rows = value.values;
      requireValue(Array.isArray(rows) && rows.length <= pageSize && all.length + rows.length <= maxItems && (value.startAt === undefined || value.startAt === startAt), 'Plugin list is incomplete or exceeds its bound.');
      const signature = JSON.stringify(rows); requireValue(!seen.has(signature), 'Plugin pagination did not advance.'); seen.add(signature); all.push(...rows);
      requireValue(value.total === undefined || Number.isSafeInteger(value.total) && value.total >= all.length && value.total <= maxItems, 'Plugin list total is incomplete.');
      if (value.isLast === true || value.total === all.length) {requireValue(value.total === undefined || value.total === all.length, 'Plugin completion contradicts its total.'); return all;}
      requireValue(rows.length > 0 && (value.isLast === false || value.total > all.length), 'Plugin list pagination is incomplete.'); startAt += rows.length;
    }
    throw new Error('Plugin list exceeds 100 pages.');
  }
  return Object.freeze({provider, base, destination, request, read, query, list});
}
