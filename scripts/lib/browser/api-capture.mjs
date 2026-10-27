import {writeFile} from 'node:fs/promises';
import {readFileSync, lstatSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sanitizeApiObservation, storeApiCandidate, readApiCandidate} from '../api/discovery.mjs';
import {consumerPath, consumerRoots} from '../consumer-paths.mjs';
import {data} from '../execution-core/data.mjs';

// Serialized only into the owned native CLI process. No routing, replay or page mutation.
function nativeCollector(page, input) {
  const context = page.context(), key = '__harnessObservedApiV1';
  let state = context[key];
  if (!state) {
    state = context[key] = {active: null, records: [], requests: new Map(), count: 0, bytes: 0, gaps: new Set()};
    const body = (text, contentType) => {
      if (text === null) return {state: 'omitted', contentType};
      const size = Buffer.byteLength(text);
      if (size > 16384 || state.bytes + size > 1048576) {state.gaps.add('body-limit'); return {state: 'truncated', contentType};}
      state.bytes += size; return {state: 'known', contentType, text};
    };
    const headers = values => Object.entries(values).slice(0, 100).map(([name, value]) => ({name: name.slice(0, 128), value: name === 'content-type' ? value.slice(0, 128) : ''}));
    context.on('request', request => {
      try {
        if (!state.active || !['fetch', 'xhr'].includes(request.resourceType())) return;
        const url = new URL(request.url());
        if (!input.origins.includes(url.origin) || url.username || url.password || request.url().length > 16384 || /(?:^|\/)(?:analytics|telemetry|collect|beacon)(?:\/|$)/i.test(url.pathname)) return;
        if (state.count >= 100) {state.gaps.add('observation-limit'); return;}
        const values = request.headers(), record = {identity: {...state.active}, method: request.method(), url: request.url(), resourceType: request.resourceType(),
          requestHeaders: headers(values), requestHeadersState: 'unknown', responseHeaders: [], responseHeadersState: 'unknown', requestBody: body(request.postData(), values['content-type']), responseBody: {state: 'unknown'}, status: null};
        state.count++; state.records.push(record); state.requests.set(request, record);
        // headers() omits cookie/security headers; ownership is assigned before this asynchronous read.
        request.allHeaders().then(all => {record.requestHeaders = headers(all); record.requestHeadersState = Object.keys(all).length <= 100 ? 'known' : 'truncated';}).catch(() => {});
      } catch {state.gaps.add('request-unavailable');}
    });
    context.on('response', async response => {
      const record = state.requests.get(response.request()); if (!record) return;
      try {
        record.status = response.status(); const values = await response.allHeaders(), contentType = values['content-type'] ?? '';
        record.responseHeaders = headers(values); record.responseHeadersState = Object.keys(values).length <= 100 ? 'known' : 'truncated';
        if ([204, 304].includes(record.status) || record.method === 'HEAD') record.responseBody = {state: 'omitted', contentType};
        else if (!/^(?:application\/(?:[a-z-]+\+)?json|application\/x-www-form-urlencoded|text\/plain)(?:;|$)/i.test(contentType)) record.responseBody = {state: 'unsupported', contentType};
        else if (Number(values['content-length']) > 16384) record.responseBody = {state: 'truncated', contentType};
        else record.responseBody = body((await response.body()).toString('utf8'), contentType);
      } catch {record.responseBody = {state: 'unknown'};}
    });
    context.on('requestfailed', request => {const record = state.requests.get(request); if (record) record.responseBody = {state: 'unknown'};});
  }
  if (input.action === 'begin') {
    if (state.active) throw new Error('Capture already has an owner.');
    state.active = input.identity; return {ready: true};
  }
  if (input.action !== 'end' || !state.active || state.active.attemptId !== input.identity.attemptId) throw new Error('Capture ownership mismatch.');
  state.active = null;
  const result = {records: state.records, gaps: [...state.gaps]};
  state.records = []; state.requests.clear(); state.gaps.clear(); return result;
}

export function nativeCaptureCode(action, identity, origins) {
  return `page => (${nativeCollector.toString()})(page, ${JSON.stringify({action, identity, origins})})`;
}

function leaves(value, path = [], result = []) {
  if (result.length >= 128 || path.length > 10) return result;
  if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) if (Array.isArray(value) || (!/password|secret|token|cookie|authorization|csrf|api.?key/i.test(name) && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name))) leaves(child, [...path, Array.isArray(value) ? Number(name) : name], result);
  } else if ((typeof value === 'string' && value.length >= 3 && value.length <= 256) || typeof value === 'number') result.push({path, value});
  return result;
}
function jsonBody(body) {try {return body?.state === 'known' && /json/.test(body.contentType ?? '') ? JSON.parse(body.text) : undefined;} catch {return undefined;}}

/** Capture is informational: bounded failures become gaps without changing the business verdict. */
export function createApiCapture(run, roots, native, target) {
  let sequence = 0, disabled = false;
  const variants = new Map(), prior = [], summary = {version: 1, runId: run.id, candidates: [], gaps: []};
  const gap = reason => {if (!summary.gaps.includes(reason)) summary.gaps.push(reason);};
  function budget(window) {
    const current = window(), remaining = current.timeoutMs;
    if (remaining < 3000) throw new Error('Capture has no remaining budget.');
    return {...current, timeoutMs: Math.min(4000, Math.floor(remaining / 4))};
  }
  return {
    async begin(identity, window) {
      if (!native.capture) {gap('capture-unavailable'); return false;}
      if (disabled || sequence >= 100) {gap('observation-limit'); return false;}
      try {await native.capture('begin', identity, budget(window)); return true;} catch {disabled = true; gap('capture-unavailable'); return false;}
    },
    async end(identity, window, save, evidenceFor) {
      try {
        const captured = await native.capture('end', identity, budget(window));
        if (!captured || !Array.isArray(captured.records) || captured.records.length > 100 || !Array.isArray(captured.gaps)) throw new Error('Invalid capture envelope.');
        for (const reason of captured.gaps) if (['body-limit', 'observation-limit', 'request-unavailable'].includes(reason)) gap(reason);
        for (const raw of captured.records) {
          if (sequence >= 100) {gap('observation-limit'); break;}
          try {
          if (JSON.stringify(raw.identity) !== JSON.stringify(identity)) throw new Error('Capture identity mismatch.');
          const signature = JSON.stringify([raw.method, raw.url, raw.requestBody]);
          if (!variants.has(signature)) variants.set(signature, `variant-${variants.size + 1}`);
          const decode = value => {try {return decodeURIComponent(value);} catch {return value;}};
          const url = new URL(raw.url);
          const prefixes = Object.values(run.inputs.environment.targets.api).map(config => new URL(config.baseUrl)).filter(base => base.origin === url.origin && (!base.pathname.replace(/\/$/, '') || url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')));
          const path = prefixes.length === 1 ? url.pathname.slice(prefixes[0].pathname.replace(/\/$/, '').length) : url.pathname;
          const inputs = [...leaves(jsonBody(raw.requestBody), ['body']), ...[...url.searchParams].filter(([name]) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)).map(([name, value]) => ({path: ['query', name], value})), ...path.split('/').filter(Boolean).map((value, index) => ({path: ['path', index], value: decode(value)}))];
          const relationships = [];
          for (const input of inputs) for (const output of prior) if (input.value === output.value && relationships.length < 32) relationships.push({fromSequence: output.sequence, fromPath: output.path, toPath: input.path});
          const observation = sanitizeApiObservation(raw, {run, identity, browserTarget: target, sequence: sequence + 1, variantId: variants.get(signature), relationships});
          if (!observation) continue;
          sequence++;
          const evidenceId = await save(observation), candidate = storeApiCandidate(run, roots, {observation, evidence: evidenceFor(evidenceId)});
          summary.candidates.push({id: candidate.id, sequence, method: observation.method, target: observation.target, path: observation.observedPath, gaps: observation.gaps});
          for (const item of leaves(jsonBody(raw.responseBody))) if (prior.length < 256) prior.push({...item, sequence});
          } catch {gap('observation-unavailable');}
        }
      } catch {disabled = true; gap('capture-incomplete');}
    },
    async finish() {
      variants.clear(); prior.length = 0;
      await writeFile(join(roots.runRoot, 'api-discovery.json'), JSON.stringify(summary, null, 2), {flag: 'wx', mode: 0o600});
    }
  };
}

/** Read only this run's referenced candidates; invalid discovery cannot change its verdict. */
export function readApiDiscoverySummary(roots, runRoot, runId) {
  try {
    const file = consumerPath(consumerRoots(roots.projectRoot, roots.packageRoot), join(runRoot, 'api-discovery.json'));
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error();
    const summary = data(JSON.parse(readFileSync(file, 'utf8')), 256 * 1024);
    if (summary.runId !== runId || !Array.isArray(summary.candidates) || summary.candidates.length > 100 || !Array.isArray(summary.gaps)) throw new Error();
    const candidates = summary.candidates.map(({id}) => {
      const {observation} = readApiCandidate(roots, id);
      if (observation.identity.runId !== runId) throw new Error();
      return {id, method: observation.method, target: observation.target, path: observation.observedPath, status: 'unreviewed', gaps: observation.gaps};
    });
    const allowed = ['body-limit', 'observation-limit', 'request-unavailable', 'capture-unavailable', 'capture-incomplete', 'observation-unavailable'];
    return {runId, candidates, gaps: summary.gaps.filter(reason => allowed.includes(reason))};
  } catch (error) {
    return {runId, candidates: [], gaps: error.code === 'ENOENT' ? [] : ['discovery-summary-unavailable']};
  }
}
