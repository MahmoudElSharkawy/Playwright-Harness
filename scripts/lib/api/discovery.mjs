import {mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, openSync, closeSync, unlinkSync, renameSync, existsSync} from 'node:fs';
import {join, relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {data, digest, fingerprint, frozen, identity as checkIdentity, id, requireThat, integer, keys} from '../execution-core/data.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {assessRun, verifyEvidence} from '../execution-core/index.mjs';
import {validateApiOperation} from './definition.mjs';
import {reviewArtifact} from '../generation/storage.mjs';

const MAX_BYTES = 16384, MAX_ITEMS = 100, MAX_STORE = 1000;
const CAPTURES = new WeakSet();
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const BODY_STATES = new Set(['known', 'omitted', 'unknown', 'unsupported', 'truncated']);
const AUTH_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'api-key', 'x-auth-token']);
const SAFE_ROUTE_SEGMENTS = new Set('api v1 v2 v3 orders items records users customers draft submit status create update delete search lookup login logout auth token'.split(' '));
// Unknown property names may themselves be customer data (for example, dictionary keys).
const SAFE_FIELDS = new Set(('id ids name title description status state type kind value values key code message error errors data result results item items record records order orders orderId recordId userId customer customerId session label email phone address quantity count total amount price currency createdAt updatedAt version enabled active success search query filter sort page pageSize offset limit view include fields expand format action mode draft submitted details lines products productId owner ownerId reference metadata token password secret accessToken refreshToken csrfToken authorization cookie set-cookie accept content-type content-length user-agent origin referer host if-match if-none-match idempotency-key x-api-key api-key x-auth-token x-csrf-token x-xsrf-token').split(' '));
const mediaTypes = new Set(['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'text/html', 'application/octet-stream', 'multipart/form-data', 'text/event-stream']);
const mediaType = value => {const type = String(value ?? '').split(';')[0].trim().toLowerCase(); return mediaTypes.has(type) || /^application\/[a-z-]+\+json$/.test(type) ? type : 'unknown';};
const fieldName = (value, index) => SAFE_FIELDS.has(value) ? value : `redactedField${index}`;

function shape(value, path = [], counter = {nodes: 0}) {
  requireThat(++counter.nodes <= 256 && path.length <= 12, 'Observed body structure exceeds its limit.');
  if (Array.isArray(value)) {requireThat(value.length <= 32, 'Observed array exceeds its limit.'); return {type: 'array', items: value.map((item, index) => shape(item, [...path, index], counter))};}
  if (value && typeof value === 'object') {
    const entries = Object.entries(value); requireThat(entries.length <= 64, 'Observed object exceeds its limit.');
    return {type: 'object', fields: entries.map(([name, item], index) => ({name: fieldName(name, index), value: shape(item, [...path, name], counter)}))};
  }
  return {type: value === null ? 'null' : typeof value, input: `value${counter.nodes}`};
}

function body(input = {state: 'unknown'}) {
  const state = BODY_STATES.has(input.state) ? input.state : 'unknown', contentType = mediaType(input.contentType);
  if (state !== 'known') return {state, contentType};
  if (typeof input.text !== 'string') return {state: 'unknown', contentType};
  if (Buffer.byteLength(input.text) > MAX_BYTES) return {state: 'truncated', contentType};
  if (!input.text.length) return {state: 'known', contentType, structure: {type: 'empty'}};
  try {
    if (contentType === 'application/json' || contentType.endsWith('+json')) return {state: 'known', contentType, structure: shape(JSON.parse(input.text))};
    if (contentType === 'application/x-www-form-urlencoded') {
      const pairs = [...new URLSearchParams(input.text)];
      if (new Set(pairs.map(([name]) => name)).size !== pairs.length) return {state: 'unsupported', contentType};
      return {state: 'known', contentType, structure: shape(Object.fromEntries(pairs))};
    }
    return {state: contentType === 'text/plain' ? 'known' : 'unsupported', contentType, ...(contentType === 'text/plain' ? {structure: {type: 'string', input: 'value1'}} : {})};
  } catch {return {state: 'unknown', contentType};}
}

function headers(input = []) {
  requireThat(Array.isArray(input) && input.length <= 100, 'Observed headers exceed their limit.');
  return [...new Set(input.map((header, index) => fieldName(String(header.name ?? '').toLowerCase(), index)))].sort();
}

/** Structure and fixed public route vocabulary only; unknown segments and captured values are removed. */
export function sanitizeApiObservation(raw, {run, identity, browserTarget, sequence, variantId = `variant-${sequence}`, relationships = []}) {
  requireRun(run); checkIdentity(identity); id(browserTarget); id(variantId);
  requireThat(identity.runId === run.id && run.inputs.scenarios.some(item => item.id === identity.scenarioId), 'Observation has the wrong run identity.');
  requireThat(integer(sequence, 1, MAX_ITEMS), 'API observation limit reached.');
  requireThat(Array.isArray(relationships) && relationships.length <= 32, 'Observed relationships exceed their limit.');
  for (const link of relationships) {
    keys(link, ['fromSequence', 'fromPath', 'toPath'], 'observed relationship');
    requireThat(integer(link.fromSequence, 1, sequence - 1), 'Relationships must refer to an earlier observation.');
    for (const path of [link.fromPath, link.toPath]) requireThat(Array.isArray(path) && path.length <= 12 && path.every(part => integer(part, 0, 31) || typeof part === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(part)), 'Invalid observed relationship selector.');
  }
  if (!['fetch', 'xhr'].includes(raw.resourceType)) return null;
  let url; try {url = new URL(raw.url);} catch {return null;}
  if (!run.inputs.environment.targets.browser[browserTarget]?.origins.includes(url.origin) || url.username || url.password) return null;
  if (/(?:^|\/)(?:analytics|telemetry|collect|beacon)(?:\/|$)/i.test(url.pathname)) return null;
  requireThat(METHODS.has(raw.method) && Buffer.byteLength(url.href) <= MAX_BYTES, 'Invalid or oversized observed request.');
  const matches = Object.entries(run.inputs.environment.targets.api).filter(([, config]) => {
    const base = new URL(config.baseUrl), prefix = base.pathname.replace(/\/$/, '');
    return base.origin === url.origin && (prefix === '' || url.pathname.startsWith(prefix + '/') || url.pathname === prefix);
  });
  const selected = matches.length === 1 ? matches[0] : null, [target, targetConfig] = selected ?? [null, null];
  const path = selected ? url.pathname.slice(new URL(targetConfig.baseUrl).pathname.replace(/\/$/, '').length) : url.pathname;
  const segments = path.split('/').filter(Boolean); requireThat(segments.length <= 24, 'Observed path exceeds its limit.');
  const query = [...url.searchParams].map(([name], index) => ({name: fieldName(name, index), input: `query${index + 1}`}));
  requireThat(query.length <= 64, 'Observed query exceeds its limit.');
  const requestHeaders = headers(raw.requestHeaders), responseHeaders = headers(raw.responseHeaders);
  const requestBody = body(raw.requestBody), responseBody = body(raw.responseBody);
  const gaps = ['route-unreviewed', 'authentication-unverified', 'effects-unverified', 'cleanup-unverified'];
  if (raw.requestHeadersState && raw.requestHeadersState !== 'known') gaps.push('request-headers-unavailable');
  if (raw.responseHeadersState && raw.responseHeadersState !== 'known') gaps.push('response-headers-unavailable');
  if (!selected) gaps.push(matches.length ? 'ambiguous-target' : 'unconfigured-target');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(raw.method)) gaps.push('unsupported-method');
  if (new Set(query.map(item => item.name)).size !== query.length) gaps.push('duplicate-query-fields');
  if ((raw.requestHeaders ?? []).some(({name}) => /auth|session|token|secret|key|credential|csrf|xsrf/i.test(String(name)) && !AUTH_HEADERS.has(String(name).toLowerCase()) && String(name).toLowerCase() !== 'idempotency-key')) gaps.push('unsupported-session-header');
  if (JSON.stringify({query, requestBody}).includes('redactedField')) gaps.push('field-names-redacted');
  if (JSON.stringify(responseBody).includes('redactedField')) gaps.push('response-field-names-redacted');
  for (const [side, value] of [['request', requestBody], ['response', responseBody]]) if (['unknown', 'unsupported', 'truncated'].includes(value.state)) gaps.push(`${side}-body-${value.state}`);
  const observation = {version: 1, kind: 'observed-api', status: 'unreviewed', identity: {...identity}, inputFingerprint: run.inputFingerprint,
    environment: run.inputs.environment.name, browserTarget, target, targetFingerprint: targetConfig ? fingerprint(targetConfig) : null,
    sequence, variantId, method: raw.method, observedPath: '/' + segments.map((segment, index) => SAFE_ROUTE_SEGMENTS.has(segment) ? segment : `{segment${index + 1}}`).join('/'),
    request: {query, headerNames: requestHeaders, body: requestBody}, response: {status: integer(raw.status, 100, 599) ? raw.status : null, headerNames: responseHeaders, body: responseBody},
    relationships: relationships.filter(link => link.fromPath.every(part => typeof part === 'number' || SAFE_FIELDS.has(part)) &&
      link.toPath.every((part, index) => typeof part === 'number' || (index === 0 && ['body', 'query', 'path'].includes(part)) || SAFE_FIELDS.has(part))), gaps,
    limits: {maxObservations: MAX_ITEMS, maxBodyBytes: MAX_BYTES, values: 'removed', routeSegments: 'fixed-public-vocabulary-only', unknownFieldNames: 'removed'}};
  const sanitized = frozen(data(observation, MAX_BYTES)); CAPTURES.add(sanitized); return sanitized;
}

function location(roots, area, name) {
  roots = consumerRoots(roots.projectRoot, roots.packageRoot);
  return consumerPath(roots, `${area}/${name}`);
}
function jsonFile(path, maximum = 1024 * 1024) {
  const stat = lstatSync(path); requireThat(!stat.isSymbolicLink() && stat.isFile() && stat.size > 0 && stat.size <= maximum, 'Invalid bounded knowledge file.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function saveImmutable(roots, area, content) {
  const checked = data(content), recordId = fingerprint(checked), directory = location(roots, area, 'records');
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const path = location(roots, area, `records/${recordId}.json`), record = {id: recordId, ...checked};
  requireThat(existsSync(path) || readdirSync(directory).filter(file => file.endsWith('.json')).length < MAX_STORE, 'API knowledge store limit reached.');
  try {writeFileSync(path, JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});}
  catch (error) {if (error.code !== 'EEXIST') throw error; requireThat(fingerprint(jsonFile(path)) === fingerprint(record), 'Existing API knowledge integrity changed.');}
  return frozen({...record, path});
}
function loadImmutable(roots, area, recordId) {
  requireThat(typeof recordId === 'string' && /^[a-f0-9]{64}$/.test(recordId), 'Invalid API knowledge identity.');
  const path = location(roots, area, `records/${recordId}.json`), {id: stored, ...record} = data(jsonFile(path));
  requireThat(stored === recordId && fingerprint(record) === recordId, 'API knowledge integrity changed.');
  return frozen({id: recordId, ...record, path});
}
const CANDIDATES = '.harness/knowledge-candidates/api', REVIEWED = '.harness/knowledge/api';

export function storeApiCandidate(run, roots, {observation, evidence}) {
  requireRun(run); requireThat(CAPTURES.has(observation), 'Capture must pass the API sanitizer before persistence.'); const checked = data(observation, MAX_BYTES);
  requireThat(checked.kind === 'observed-api' && checked.status === 'unreviewed' && checked.inputFingerprint === run.inputFingerprint, 'Candidate must come from this unreviewed capture.');
  const verified = verifyEvidence(run, roots, evidence);
  requireThat(evidence.kind === 'observation' && fingerprint(evidence.identity) === fingerprint(checked.identity) && fingerprint(jsonFile(verified.actual, MAX_BYTES)) === fingerprint(checked), 'Candidate evidence does not match its capture.');
  return saveImmutable(roots, CANDIDATES, {version: 1, observation: checked, evidence: data(evidence), sourceRunRoot: relative(roots.projectRoot, roots.runRoot).replaceAll('\\', '/')});
}
export function readApiCandidate(roots, candidateId) {
  const record = loadImmutable(roots, CANDIDATES, candidateId);
  const evidence = location(roots, record.sourceRunRoot, record.evidence.path), stat = lstatSync(evidence);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size === record.evidence.bytes && stat.size <= MAX_BYTES && digest(readFileSync(evidence)) === record.evidence.sha256, 'Original capture evidence integrity changed.');
  return record;
}
function list(roots, area, load) {
  const directory = location(roots, area, 'records'); if (!existsSync(directory)) return [];
  const names = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
  requireThat(names.length <= MAX_STORE, 'API knowledge store limit reached.'); return names.map(name => load(roots, name.slice(0, -5)));
}
export function listApiCandidates(roots, {runId, scenarioId} = {}) {
  return list(roots, CANDIDATES, (context, candidateId) => {
    const item = loadImmutable(context, CANDIDATES, candidateId);
    return (runId === undefined || item.observation.identity.runId === runId) && (scenarioId === undefined || item.observation.identity.scenarioId === scenarioId) ? readApiCandidate(context, candidateId) : null;
  }).filter(Boolean);
}

function shapeMatches(structure, value) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$input === 'string') return !['object', 'array', 'empty'].includes(structure.type);
  if (structure.type === 'object') return value && typeof value === 'object' && !Array.isArray(value) &&
    fingerprint(Object.keys(value).sort()) === fingerprint(structure.fields.map(field => field.name).sort()) && structure.fields.every(field => shapeMatches(field.value, value[field.name]));
  if (structure.type === 'array') return Array.isArray(value) && value.length === structure.items.length && structure.items.every((item, index) => shapeMatches(item, value[index]));
  return structure.type === (value === null ? 'null' : typeof value);
}
function verifyJsonInputTypes(structure, value, inputs) {
  if (value && typeof value === 'object' && Object.hasOwn(value, '$input')) {
    requireThat(inputs.some(input => input.name === value.$input && input.type === structure?.type), 'Verified JSON input type differs from the observed scalar type.'); return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => verifyJsonInputTypes(structure?.items?.[index], item, inputs));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) verifyJsonInputTypes(structure?.fields?.find(field => field.name === name)?.value, item, inputs);
}
function reviewMatches(observation, operation) {
  const request = operation.definition.request;
  requireThat(!observation.gaps.includes('request-headers-unavailable'), 'Authentication headers were not completely observed.');
  requireThat(!observation.gaps.includes('field-names-redacted'), 'Unknown field names were removed; establish their contract in a separately reviewed source before reuse.');
  requireThat(observation.target === operation.target && observation.method === request.method, 'Reviewed operation differs from the observed target/method.');
  requireThat(observation.observedPath.split('/').filter(Boolean).length === request.path.split('/').filter(Boolean).length, 'Reviewed route structure differs from the observation.');
  const reviewedSegments = request.path.split('/').filter(Boolean);
  requireThat(observation.observedPath.split('/').filter(Boolean).every((segment, index) => /^\{segment[0-9]+\}$/.test(segment) || segment === reviewedSegments[index]), 'Reviewed route changed an observed literal segment.');
  requireThat(fingerprint(observation.request.query.map(item => item.name).sort()) === fingerprint(Object.keys(request.query ?? {}).sort()), 'Reviewed query structure differs from the observation.');
  const observed = observation.request.body;
  requireThat(['known', 'omitted'].includes(observed.state), 'Unreadable or unsupported request body cannot establish a reusable definition.');
  if (observed.state === 'omitted' || observed.structure?.type === 'empty') requireThat(!Object.hasOwn(request, 'json') && !Object.hasOwn(request, 'form'), 'Reviewed body differs from the omitted observation.');
  else {
    const key = observed.contentType === 'application/x-www-form-urlencoded' ? 'form' : 'json';
    requireThat((key === 'form' || observed.contentType === 'application/json' || observed.contentType.endsWith('+json')) && Object.hasOwn(request, key) && shapeMatches(observed.structure, request[key]), 'Reviewed body structure differs from supported captured data.');
  }
  requireThat(!observation.gaps.includes('unsupported-session-header') && !observation.gaps.includes('duplicate-query-fields'), 'Observed authentication/session or repeated query format is unsupported.');
  for (const extraction of operation.definition.extract ?? []) {
    if (extraction.select.from === 'status') continue;
    if (extraction.select.from === 'header') {
      requireThat(observation.response.headerNames.includes(String(extraction.select.path[0]).toLowerCase()), 'Response extraction header was not observed.'); continue;
    }
    requireThat(observation.response.body.state === 'known', 'Response extraction needs readable observed data.');
    let selected = observation.response.body.structure;
    if (extraction.select.from === 'json') for (const part of extraction.select.path) selected = selected?.type === 'array' && integer(part, 0, 31)
      ? selected.items[part] : selected?.type === 'object' ? selected.fields.find(field => field.name === part)?.value : undefined;
    else requireThat(selected?.type === 'string', 'Text extraction needs observed text.');
    requireThat(selected?.type === extraction.type, 'Response extraction must name an observed field with the declared type.');
  }
}

/** Review is an auditable attestation; validation must come from a real, assessed API run. */
export function reviewApiCandidate(roots, {candidateId, operation, review, validation}) {
  const candidate = readApiCandidate(roots, candidateId), observation = candidate.observation;
  operation = validateApiOperation(operation); reviewMatches(observation, operation);
  const checked = data(review); keys(checked, ['reviewer', 'artifact', 'purpose', 'inputs', 'authentication', 'responseExtraction', 'stateEffects', 'cleanup'], 'API review');
  id(checked.reviewer);
  for (const name of ['purpose', 'inputs', 'responseExtraction', 'stateEffects']) requireThat(typeof checked[name] === 'string' && checked[name].trim().length > 0 && checked[name].length <= 2000, 'Review must establish purpose, inputs, response extraction and effects.');
  requireThat(['none', 'configured'].includes(checked.authentication?.kind), 'Authentication must be established before reuse.');
  requireThat(['none', 'verified'].includes(checked.cleanup?.kind), 'Cleanup must be resolved before reuse.');
  const artifact = reviewArtifact(roots, checked.artifact);
  requireThat(validation?.run && validation.roots && validation.observations, 'Configured API validation is required.');
  requireThat(consumerRoots(validation.roots.projectRoot, validation.roots.packageRoot).projectRoot === consumerRoots(roots.projectRoot, roots.packageRoot).projectRoot, 'Validation must belong to this consumer.');
  const result = assessRun(validation.run, validation.roots, validation.observations);
  const environment = validation.run.inputs.environment, config = environment.targets.api[operation.target];
  requireThat(environment.name === observation.environment && config && fingerprint(config) === observation.targetFingerprint, 'Validation target or environment drifted from the observation.');
  const attempt = result.scenarios.flatMap(scenario => scenario.attempts).find(item => item.identity.attemptId === validation.attemptId);
  requireThat(result.status === 'PASS' && result.scenarios.every(scenario => scenario.requiredLifecycleComplete) && attempt?.outcome === 'SUCCESS' && attempt.operationFingerprint === operation.fingerprint && attempt.assertions.length > 0 && attempt.assertions.every(item => item.status === 'PASS' && item.reliable), 'API verification needs a successful bound operation and complete lifecycle.');
  requireThat(result.operations.some(item => item.fingerprint === operation.fingerprint), 'Validation did not execute the reviewed operation.');
  const inputTypes = attempt.inputs.map(({name, type}) => ({name, type}));
  if (Object.hasOwn(operation.definition.request, 'json')) verifyJsonInputTypes(observation.request.body.structure, operation.definition.request.json, inputTypes);
  const observedAuthentication = observation.request.headerNames.some(name => AUTH_HEADERS.has(name));
  requireThat(!observedAuthentication || checked.authentication.kind === 'configured' && Boolean(config.credentialRef), 'Observed authentication needs a configured credential reference and verified resolver.');
  requireThat(checked.authentication.kind !== 'configured' || Boolean(config.credentialRef), 'Configured authentication requires a credential reference.');
  const cleanup = [];
  if (checked.cleanup.kind === 'verified') {
    id(checked.cleanup.operationId);
    const scenario = result.scenarios.find(item => item.id === attempt.identity.scenarioId);
    const resources = scenario.resources.filter(resource => attempt.effect.resourceIds.includes(resource.id) && ['cleanup', 'restore'].includes(resource.lifecycle.action));
    requireThat(resources.length > 0, 'Verified cleanup needs a lifecycle resource bound to the validated operation.');
    for (const resource of resources) {
      const lifecycleAttempt = scenario.attempts.find(item => item.identity.attemptId === resource.lifecycle.attemptId);
      requireThat(resource.lifecycle.status === 'completed' && lifecycleAttempt?.identity.operationId === checked.cleanup.operationId && lifecycleAttempt.outcome === 'SUCCESS', 'Every bound resource needs the named verified lifecycle operation.');
      cleanup.push({resource, attempt: {identity: lifecycleAttempt.identity, operationFingerprint: lifecycleAttempt.operationFingerprint, evidenceIds: lifecycleAttempt.evidenceIds}});
    }
  } else requireThat(operation.definition.effects.readOnlyContract || ['intentional-persistence', 'no-owned-resource'].includes(checked.cleanup.reason), 'Mutation cleanup requires a verified route or an explicit reviewed lifecycle reason.');
  const evidenceIds = new Set([...attempt.evidenceIds, ...cleanup.flatMap(item => item.attempt.evidenceIds)]);
  const verification = {runId: validation.run.id, inputFingerprint: validation.run.inputFingerprint, attemptId: validation.attemptId, operationFingerprint: operation.fingerprint,
    environment: environment.name, targetFingerprint: fingerprint(config), inputTypes, ...(cleanup.length ? {cleanup} : {}), evidence: result.evidence.filter(item => evidenceIds.has(item.id)).map(item => ({id: item.id, identity: item.identity, kind: item.kind, path: relative(roots.projectRoot, join(validation.roots.runRoot, item.path)).replaceAll('\\', '/'), sha256: item.sha256, bytes: item.bytes}))};
  return saveImmutable(roots, REVIEWED, {version: 1, status: 'reviewed-verified', candidateId, operation, review: {...checked, artifact}, verification});
}

export function readReviewedApi(roots, reviewedId) {
  const record = loadImmutable(roots, REVIEWED, reviewedId); validateApiOperation(record.operation); const candidate = readApiCandidate(roots, record.candidateId);
  if (Object.hasOwn(record.operation.definition.request, 'json')) verifyJsonInputTypes(candidate.observation.request.body.structure, record.operation.definition.request.json, record.verification.inputTypes ?? []);
  requireThat(fingerprint(reviewArtifact(roots, record.review.artifact.path)) === fingerprint(record.review.artifact), 'Review artifact changed.');
  if (record.review.cleanup.kind === 'verified') {
    requireThat(Array.isArray(record.verification.cleanup) && record.verification.cleanup.length > 0, 'Reviewed cleanup dependencies are unavailable; validate and review the lifecycle again.');
    for (const {resource, attempt} of record.verification.cleanup) {
      requireThat(resource.lifecycle.status === 'completed' && resource.lifecycle.attemptId === attempt.identity.attemptId && attempt.identity.runId === record.verification.runId && attempt.identity.operationId === record.review.cleanup.operationId && attempt.identity.phase === resource.lifecycle.action.toUpperCase(), 'Reviewed cleanup identity changed.');
      requireThat(resource.lifecycle.evidenceIds.length > 0 && resource.lifecycle.evidenceIds.every(id => attempt.evidenceIds.includes(id)) &&
        attempt.evidenceIds.every(id => record.verification.evidence.some(item => item.id === id && fingerprint(item.identity) === fingerprint(attempt.identity))) &&
        record.verification.evidence.some(item => resource.lifecycle.evidenceIds.includes(item.id) && item.kind === 'lifecycle'), 'Reviewed cleanup evidence is missing or unbound.');
    }
  }
  for (const evidence of record.verification.evidence) {
    const path = location(roots, '.', evidence.path), stat = lstatSync(path);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size === evidence.bytes, 'Verification evidence changed.');
    // Evidence digests use raw bytes, unlike canonical JSON fingerprints.
    requireThat(digest(readFileSync(path)) === evidence.sha256, 'Verification evidence integrity changed.');
  }
  return record;
}
export function listReviewedApis(roots) {return list(roots, REVIEWED, readReviewedApi);}

function template(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, '$input')) return `{{${value.$input}}}`;
  if (Array.isArray(value)) return value.map(template);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, template(item)]));
  return value;
}
// Postman substitutes variables before JSON parsing; quoted numeric/boolean slots change wire types.
function jsonTemplate(value, structure) {
  if (value && typeof value === 'object' && Object.hasOwn(value, '$input')) {
    const slot = `{{${value.$input}}}`; return structure.type === 'string' ? JSON.stringify(slot) : slot;
  }
  if (Array.isArray(value)) return '[' + value.map((item, index) => jsonTemplate(item, structure.items[index])).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([name, item]) => JSON.stringify(name) + ':' + jsonTemplate(item, structure.fields.find(field => field.name === name).value)).join(',') + '}';
  return JSON.stringify(value);
}
function example(structure) {
  if (!structure || structure.type === 'empty') return '';
  if (structure.type === 'object') return Object.fromEntries(structure.fields.map(field => [field.name, example(field.value)]));
  if (structure.type === 'array') return structure.items.map(example);
  if (structure.type === 'null') return null;
  return {string: 'synthetic', number: 0, boolean: false}[structure.type] ?? 'synthetic';
}
function collectionItem(roots, record) {
  const observation = readApiCandidate(roots, record.candidateId).observation;
  const request = record.operation.definition.request, base = `{{${record.operation.target}BaseUrl}}`, path = request.path.replace(/\{([A-Za-z0-9_-]+)\}/g, '{{$1}}');
  const query = Object.entries(template(request.query ?? {})).map(([key, value]) => ({key, value: String(value)}));
  const url = {raw: base + path + (query.length ? '?' + query.map(item => `${encodeURIComponent(item.key)}=${item.value}`).join('&') : ''), host: [base], path: path.split('/').filter(Boolean), ...(query.length ? {query} : {})};
  const header = Object.entries(template(request.headers ?? {})).map(([key, value]) => ({key, value: String(value)}));
  const postman = {method: request.method, header, url, description: `${record.review.purpose}\nDerived from reviewed consumer evidence. Authentication: ${record.review.authentication.kind}; configure the existing target credential reference outside this collection. No recorded request is replayed.`};
  if (Object.hasOwn(request, 'json')) postman.body = {mode: 'raw', raw: jsonTemplate(request.json, observation.request.body.structure), options: {raw: {language: 'json'}}};
  if (Object.hasOwn(request, 'form')) postman.body = {mode: 'urlencoded', urlencoded: Object.entries(template(request.form)).map(([key, value]) => ({key, value: String(value), type: 'text'}))};
  const response = [];
  if (observation.response.body.state === 'known' && observation.response.status !== null && observation.response.body.structure && observation.response.body.contentType.includes('json')) response.push({name: 'Synthetic structural example', originalRequest: postman, status: 'Observed status; not an expected result', code: observation.response.status, header: [{key: 'content-type', value: observation.response.body.contentType}], body: JSON.stringify(example(observation.response.body.structure), null, 2)});
  return {name: `${record.review.purpose} (${record.operation.id})`, request: postman, response};
}

/** Only this owned output is mutable. A lock and integrity marker preserve concurrent writers and drift. */
export async function promoteObservedCollection(roots, {application, reviewedIds}) {
  id(application); requireThat(/^[a-z][a-z0-9-]{0,63}$/.test(application), 'Use a stable application slug.');
  requireThat(Array.isArray(reviewedIds) && reviewedIds.length > 0 && reviewedIds.length <= MAX_ITEMS && new Set(reviewedIds).size === reviewedIds.length, 'Promotion needs bounded unique reviewed identities.');
  reviewedIds.forEach(recordId => readReviewedApi(roots, recordId));
  const area = 'resources/apisCollections', directory = location(roots, area, '.'); mkdirSync(directory, {recursive: true});
  const path = location(roots, area, `${application}-observed.postman_collection.json`), lock = path + '.lock', fd = openSync(lock, 'wx', 0o600); let temporary;
  try {
    let previous;
    if (existsSync(path)) {
      previous = jsonFile(path, 4 * 1024 * 1024);
      requireThat(previous['x-harness-observed']?.origin === 'reviewed-consumer-evidence' && previous['x-harness-observed'].application === application, 'Existing collection is not owned observed output.');
      const {integrity, ...metadata} = previous['x-harness-observed'];
      requireThat(fingerprint({...previous, 'x-harness-observed': metadata}) === integrity, 'Observed collection integrity drift: review external changes before promotion.');
    }
    const allIds = [...new Set([...(previous?.['x-harness-observed'].reviewedIds ?? []), ...reviewedIds])].sort();
    requireThat(allIds.length <= MAX_STORE, 'Observed collection limit reached.');
    const all = allIds.map(recordId => readReviewedApi(roots, recordId)), byId = new Map(), groups = new Map();
    const records = new Map(all.map(record => [record.id, record]));
    for (const item of previous?.item ?? []) {
      const metadata = item['x-harness-observed'], record = records.get(metadata?.provenance?.[0]?.reviewedId);
      requireThat(record && fingerprint({target: record.operation.target, definition: record.operation.definition}) === metadata.definition, 'Observed collection representative changed.');
      groups.set(metadata.definition, {record, name: item.name, provenance: [...metadata.provenance]});
    }
    for (const record of all) {
      const operationKey = `${record.operation.target}/${record.operation.id}`, definitionKey = fingerprint({target: record.operation.target, definition: record.operation.definition});
      requireThat(!byId.has(operationKey) || byId.get(operationKey) === definitionKey, 'Conflicting reviewed operation; resolve contract drift explicitly.'); byId.set(operationKey, definitionKey);
      const group = groups.get(definitionKey) ?? {record, provenance: []};
      if (!group.provenance.some(item => item.reviewedId === record.id)) group.provenance.push({reviewedId: record.id, candidateId: record.candidateId, runId: record.verification.runId, attemptId: record.verification.attemptId});
      groups.set(definitionKey, group);
    }
    const items = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({...collectionItem(roots, group.record), ...(group.name === undefined ? {} : {name: group.name}), 'x-harness-observed': {definition: key, status: 'reviewed-verified', provenance: group.provenance}}));
    const collection = {info: {name: `${application} observed APIs`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: 'Derived from reviewed, sanitized consumer evidence and verified API definitions. Coverage is limited to observed operations. Team exports remain authoritative and unchanged.'},
      item: items, variable: [...new Set(all.map(record => `${record.operation.target}BaseUrl`))].sort().map(key => ({key, value: '', type: 'string'})),
      'x-harness-observed': {version: 1, origin: 'reviewed-consumer-evidence', application, reviewedIds: allIds,
        suppliedCollectionsPresent: readdirSync(directory).some(name => name.endsWith('.postman_collection.json') && !name.endsWith('-observed.postman_collection.json')),
        conflictPolicy: 'Reuse existing business methods and applicable supplied collections first. Review supplied-versus-observed conflicts explicitly; promotion never resolves or replaces the team contract.',
        sanitizationLedger: allIds.map(reviewedId => ({reviewedId, removed: 'Captured values, credentials, cookies, unknown route segments and host coordinates; examples are synthetic.', preserved: 'Fixed public route vocabulary, reviewed request semantics and supplied collections.'}))}};
    collection['x-harness-observed'].integrity = fingerprint(collection);
    const bytes = JSON.stringify(collection, null, 2) + '\n'; requireThat(Buffer.byteLength(bytes) <= 4 * 1024 * 1024, 'Observed collection exceeds its limit.');
    if (!previous || JSON.stringify(previous) !== JSON.stringify(collection)) {
      temporary = location(roots, area, `.${application}-observed-${randomUUID()}.tmp`); writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600, flush: true}); renameSync(temporary, path); temporary = undefined;
    }
    return {path, requests: items.length, reviewedIds: allIds, status: 'PROMOTED'};
  } finally {if (temporary) unlinkSync(temporary); closeSync(fd); unlinkSync(lock);}
}
