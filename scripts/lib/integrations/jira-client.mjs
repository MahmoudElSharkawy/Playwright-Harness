import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {requireValue} from './config.mjs';
import {validateJiraConfiguration, jiraIssueKey} from './jira-config.mjs';
import {createDelivery, externalIdentity} from './delivery.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const numericId = value => /^(?:[1-9]\d{0,19})$/.test(String(value));
function projectSearch(project, jql) {
  let quote, depth = 0, order = -1;
  for (let index = 0; index < jql.length; index++) {
    const char = jql[index];
    if (quote) {if (char === '\\') index++; else if (char === quote) quote = undefined; continue;}
    if (char === '"' || char === "'") {quote = char; continue;}
    if (char === '(') depth++;
    else if (char === ')') {depth--; requireValue(depth >= 0, 'Jira search has unbalanced parentheses.');}
    else if (!depth && (index === 0 || !/[\w]/.test(jql[index - 1])) && /^ORDER\s+BY\b/i.test(jql.slice(index))) {
      requireValue(order === -1, 'Jira search has more than one top-level ORDER BY.'); order = index;
    }
  }
  requireValue(!quote && depth === 0, 'Jira search has unclosed quotes or parentheses.');
  const filter = (order < 0 ? jql : jql.slice(0, order)).trim(), sorting = order < 0 ? '' : jql.slice(order).trim();
  requireValue(filter && (!sorting || /^ORDER\s+BY\s+\S/i.test(sorting)), 'Jira search needs criteria and complete ordering.');
  return `project = "${project}" AND (${filter})${sorting ? ' ' + sorting : ''}`;
}
export class JiraError extends Error {
  constructor(code, status) {super(`Jira ${code}${status ? ` (HTTP ${status})` : ''}.`); this.code = code; this.status = status;}
}

/** Jira-native transport. Workflow authorization/receipts are owned by shared delivery. */
export function createJiraClient({configuration, roots, resolveEmail, resolveCredential, fetchImpl = fetch}) {
  const config = validateJiraConfiguration(configuration);
  const base = config.authType === 'scoped' ? `https://api.atlassian.com/ex/jira/${config.cloudId}/rest/api/3/` : `${config.siteUrl}/rest/api/3/`;
  function destination(route) {
    requireValue(typeof route === 'string' && route.length <= 20000 && /^[A-Za-z]/.test(route) && !/[\\#\x00-\x20]/.test(route), 'Invalid Jira relative route.');
    const url = new URL(route, base); let path = url.pathname;
    try {for (let round = 0; round < 5 && path.includes('%'); round++) path = decodeURIComponent(path);} catch {throw new Error('Invalid Jira route encoding.');}
    requireValue(url.href.startsWith(base) && !url.username && !url.password && !/[%\\?#]/.test(path) && !path.split('/').includes('..'), 'Jira route escapes the configured API.');
    return url.href;
  }
  async function send(route, {method = 'GET', body, binary = false, contentType, beforeDispatch} = {}) {
    const url = destination(route), raw = Buffer.isBuffer(body), serialized = body === undefined ? undefined : raw ? body : JSON.stringify(body);
    const multipart = raw && method === 'POST' && /^issue\/[A-Z][A-Z0-9_]{1,99}-[1-9]\d{0,19}\/attachments$/.test(route) && /^multipart\/form-data; boundary=harness-[a-f0-9]{64}$/.test(contentType ?? '');
    requireValue(serialized === undefined || Buffer.byteLength(serialized) <= (multipart ? (config.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024) + 4096 : config.maxResponseBytes), 'Jira request exceeds configured bound.');
    requireValue(!raw || typeof contentType === 'string' && contentType.length <= 200 && !/[\r\n]/.test(contentType), 'Raw Jira request needs a bounded content type.');
    let email, token;
    try {[email, token] = await Promise.all([resolveEmail(), resolveCredential()]);} catch {throw new JiraError('credential-unresolved');}
    if (typeof email !== 'string' || !/^[^\s:@]+@[^\s@]+$/.test(email) || typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new JiraError('credential-unresolved');
    const controller = new AbortController(), deadline = Date.now() + config.timeoutMs, timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      for (let attempt = 0; ; attempt++) {
        beforeDispatch?.();
        response = await fetchImpl(url, {method, redirect: 'manual', signal: controller.signal,
          headers: {Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, Accept: binary ? 'application/octet-stream' : 'application/json', 'Content-Type': raw ? contentType : 'application/json', ...(multipart ? {'X-Atlassian-Token': 'no-check'} : {})}, body: serialized});
        if (response.status >= 300 && response.status < 400) throw new JiraError('redirect-refused', response.status);
        if (response.status === 401) throw new JiraError('authentication-rejected', 401);
        if (response.status === 403) throw new JiraError('permission-denied', 403);
        if (response.status === 429 || response.status >= 500) {
          const header = response.headers.get('retry-after'), seconds = header === null ? NaN : Number(header);
          const retryMs = header === null ? 250 * 2 ** attempt : Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now());
          const error = new JiraError(response.status === 429 ? 'rate-limited' : 'service-unavailable', response.status);
          if (method !== 'GET' || attempt >= 2 || !Number.isFinite(retryMs) || retryMs >= deadline - Date.now()) throw error;
          await response.body?.cancel().catch(() => {}); response = undefined;
          await delay(retryMs, undefined, {signal: controller.signal}); continue;
        }
        if (!response.ok) throw new JiraError('request-rejected', response.status);
        if (response.status === 204) return undefined;
        if (Number(response.headers.get('content-length')) > config.maxResponseBytes) throw new JiraError('response-too-large');
        const chunks = []; let length = 0;
        for await (const chunk of response.body ?? []) {length += chunk.length; if (length > config.maxResponseBytes) throw new JiraError('response-too-large'); chunks.push(chunk);}
        const bytes = Buffer.concat(chunks); if (binary) return bytes;
        let data; try {data = JSON.parse(bytes.toString('utf8'));} catch {throw new JiraError('invalid-json');}
        if (!data || typeof data !== 'object') throw new JiraError('invalid-json');
        return data;
      }
    } catch (error) {
      if (error instanceof JiraError) throw error;
      throw new JiraError(controller.signal.aborted ? 'timeout' : 'transport-failure');
    } finally {clearTimeout(timer); if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});}
  }
  let authenticated, project;
  async function identity() {
    if (!authenticated) authenticated = Promise.resolve().then(async () => {
      if (config.authType === 'scoped') {
        const server = await send('serverInfo');
        requireValue(typeof server.baseUrl === 'string' && server.baseUrl.replace(/\/$/, '') === config.siteUrl, 'Scoped Jira cloud ID belongs to a different site than the configured destination.');
      }
      const value = await send('myself'); requireValue(typeof value.accountId === 'string' && value.accountId.length > 0 && value.active === true, 'Jira authenticated identity is incomplete.'); return Object.freeze({accountId: value.accountId});
    }).catch(error => {authenticated = undefined; throw error;});
    return authenticated;
  }
  async function projectIdentity() {
    await identity();
    if (!project) project = send(`project/${config.project}`).then(value => {requireValue(numericId(value.id) && value.key === config.project && typeof value.name === 'string' && value.name.trim(), 'Jira project identity does not match configuration.'); return Object.freeze({id: String(value.id), key: value.key, name: value.name});}).catch(error => {project = undefined; throw error;});
    return project;
  }
  async function read(route) {destination(route); await identity(); return send(route);}
  async function request(route, options = {}) {
    destination(route); const method = options.method ?? 'GET';
    requireValue(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method), 'Unsupported Jira method.');
    requireValue(method === 'GET' || options.execute === true, 'Jira mutations require explicit execution authorization.');
    if (method === 'GET') await identity(); else await projectIdentity();
    return send(route, {...options, method});
  }
  async function requireIssueProject(value) {
    const expected = await projectIdentity();
    requireValue(jiraIssueKey(value?.key) && value.key.startsWith(config.project + '-') && numericId(value.id) && value.fields?.project?.key === expected.key && String(value.fields.project.id) === expected.id, 'Jira issue identity or project ownership is incomplete.');
  }
  async function issue(key) {
    requireValue(jiraIssueKey(key) && key.startsWith(config.project + '-'), 'Jira issue key must belong to the configured project.');
    await projectIdentity(); const value = await send(`issue/${key}?expand=names`);
    requireValue(value.key === key, 'Jira issue identity differs from the requested key.'); await requireIssueProject(value); return value;
  }
  async function list(route, {itemsKey = 'values', maxPages = 100, maxItems = 10000, pageSize = 100} = {}) {
    destination(route); requireValue(/^[A-Za-z][A-Za-z0-9]*$/.test(itemsKey) && Number.isInteger(maxPages) && maxPages > 0 && maxPages <= 100 && Number.isInteger(maxItems) && maxItems > 0 && maxItems <= 10000 && Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 100, 'Invalid Jira pagination bounds.');
    await projectIdentity(); const values = [], seen = new Set(); let startAt = 0;
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(destination(route)); url.searchParams.set('startAt', String(startAt)); url.searchParams.set('maxResults', String(pageSize));
      const data = await send(url.href.slice(base.length));
      const rows = Array.isArray(data) ? data : data[itemsKey]; requireValue(Array.isArray(rows), 'Jira list response is incomplete.');
      requireValue(values.length + rows.length <= maxItems, 'Jira list exceeds bounded scope.');
      const signature = hash(rows); requireValue(!seen.has(signature), 'Jira pagination did not advance.'); seen.add(signature); values.push(...rows);
      if (Array.isArray(data)) return values;
      requireValue(data.startAt === undefined || data.startAt === startAt, 'Jira pagination offset mismatch.');
      if (data.total !== undefined) requireValue(Number.isSafeInteger(data.total) && data.total >= values.length && data.total <= maxItems, 'Jira list total is incomplete or exceeds its bound.');
      const complete = data.isLast === true || data.total === values.length;
      if (complete) {requireValue(data.total === undefined || data.total === values.length, 'Jira list completion is incomplete.'); return values;}
      requireValue(rows.length > 0 && (data.isLast === false || data.total > values.length), 'Jira list pagination is incomplete.');
      startAt += rows.length;
    }
    throw new Error('Jira list exceeds the page limit.');
  }
  async function search(jql, {fields = ['summary', 'description', 'project', 'issuetype', 'status', 'updated'], maxItems = 10000} = {}) {
    requireValue(typeof jql === 'string' && jql.trim() && jql.length <= 16000 && !/[\x00-\x1f]/.test(jql), 'Jira search needs bounded selected criteria.');
    requireValue(Array.isArray(fields) && fields.length <= 100 && fields.every(value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) && Number.isInteger(maxItems) && maxItems > 0 && maxItems <= 10000, 'Invalid Jira search fields or bound.');
    const boundedJql = projectSearch(config.project, jql);
    await projectIdentity(); const issues = [], seen = new Set(), ids = new Set(); let nextPageToken;
    for (let page = 0; page < 100; page++) {
      const data = await send('search/jql', {method: 'POST', body: {jql: boundedJql, fields: [...new Set([...fields, 'project'])], maxResults: 100, ...(nextPageToken ? {nextPageToken} : {})}});
      requireValue(Array.isArray(data.issues) && issues.length + data.issues.length <= maxItems, 'Jira search is incomplete or exceeds its bound.');
      for (const value of data.issues) {await requireIssueProject(value); requireValue(!ids.has(String(value.id)), 'Jira search contains duplicate issue identities.'); ids.add(String(value.id)); issues.push(value);}
      if (data.isLast === true) {requireValue(!data.nextPageToken, 'Jira search completion contradicts pagination.'); return issues;}
      nextPageToken = data.nextPageToken;
      requireValue(data.isLast === false && data.issues.length > 0 && typeof nextPageToken === 'string' && nextPageToken.length > 0 && nextPageToken.length <= 2048, 'Jira search pagination is incomplete.');
      requireValue(!seen.has(nextPageToken), 'Jira search pagination did not advance.'); seen.add(nextPageToken);
    }
    throw new Error('Jira search exceeds the page limit.');
  }
  async function attachment(id) {requireValue(numericId(id), 'Invalid Jira attachment identity.'); await projectIdentity(); return send(`attachment/content/${id}?redirect=false`, {binary: true});}
  function attachmentRequest(issueKey, bytes, name) {
    requireValue(jiraIssueKey(issueKey) && issueKey.startsWith(config.project + '-') && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= (config.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024) && typeof name === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(name), 'Jira attachment needs a configured-project issue, bounded bytes and safe name.');
    const boundary = 'harness-' + createHash('sha256').update(name).update(bytes).digest('hex');
    requireValue(!bytes.includes(Buffer.from(boundary)), 'Multipart boundary collides with attachment content.');
    return {route: `issue/${issueKey}/attachments`, body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]), options: {method: 'POST', raw: true, contentType: `multipart/form-data; boundary=${boundary}`}};
  }
  function delivery(kind, execute, sourceFingerprint) {
    return createDelivery({roots, provider: 'Jira', kind, execute, sourceFingerprint, base, destination,
      send: (route, options) => request(route, {...options, execute: true}), isRemoteError: error => error instanceof JiraError,
      identityFor(operation, data) {
        const key = {'create-bug': 'issueKey', 'create-case': 'testKey', 'create-comment': 'commentId', 'upload-attachment': 'attachmentId'}[operation];
        const value = key === 'issueKey' || key === 'testKey' ? data?.key : key === 'attachmentId' && Array.isArray(data) && data.length === 1 ? data[0]?.id : data?.id;
        return key && externalIdentity(value) ? {[key]: String(value)} : undefined;
      }});
  }
  return Object.freeze({configuration: config, read, request, delivery, identity, projectIdentity, issue, requireIssueProject, list, search, attachment, attachmentRequest});
}
