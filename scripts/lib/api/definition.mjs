import {defineOperation} from '../execution-core/index.mjs';
import {operationInput} from '../execution-core/inputs.mjs';
import {id, keys, oneOf, requireThat, integer, unique} from '../execution-core/data.mjs';

export const apiCapabilities = Object.freeze(['apiReads', 'apiMutations']);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const HEADERS = new Set(['accept', 'content-type', 'if-match', 'if-none-match', 'idempotency-key']);
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const slot = value => value && typeof value === 'object' && Object.hasOwn(value, '$input');
const capability = definition => definition.request?.method === 'GET' && definition.effects?.readOnlyContract ? 'apiReads' : 'apiMutations';

function selector(value) {
  keys(value, ['from', 'path'], 'API selector'); oneOf(value.from, ['status', 'json', 'text', 'header']);
  requireThat(Array.isArray(value.path) && value.path.length <= 16, 'API selectors need a bounded path.');
  if (value.from === 'status' || value.from === 'text') requireThat(value.path.length === 0, 'Scalar selectors have no path.');
  if (value.from === 'header') requireThat(value.path.length === 1 && typeof value.path[0] === 'string', 'Header selector needs one name.');
  for (const part of value.path) requireThat((typeof part === 'string' && part.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(part)) || integer(part), 'Invalid API selector segment.');
}
function template(value) {
  if (slot(value)) { keys(value, ['$input'], 'input slot'); id(value.$input); }
  else if (value && typeof value === 'object') Object.values(value).forEach(template);
}
function request(value, readOnly = false) {
  keys(value, ['method', 'path', 'query', 'headers', 'json'], 'API request');
  oneOf(value.method, readOnly ? ['GET'] : METHODS);
  requireThat(typeof value.path === 'string' && value.path.startsWith('/') && !value.path.startsWith('//') && !/[\\?#\s]/.test(value.path), 'Use a target-relative API path without query or fragment.');
  for (const [name, item] of Object.entries(value.headers ?? {})) {
    requireThat(HEADERS.has(name), 'API header is not supported; credentials belong to the target resolver.');
    requireThat(typeof item === 'string' || slot(item), 'API header needs text or an input slot.');
  }
  keys(value.headers ?? {}, [...HEADERS], 'API headers');
  for (const item of Object.values(value.query ?? {})) requireThat(scalar(item) || slot(item), 'API query values must be scalar or input slots.');
  requireThat(value.query === undefined || (value.query && typeof value.query === 'object' && !Array.isArray(value.query)), 'API query must be an object.');
  requireThat(value.method !== 'GET' || value.json === undefined, 'GET bodies are not supported.'); template(value);
}
function statuses(value) { unique(value, 'HTTP statuses'); value.forEach(status => requireThat(integer(status, 100, 599), 'Invalid HTTP status.')); }

/** A versioned request definition is identical for catalog, helper, inline and exploration sources. */
export function defineApiOperation({id: operationId, target, source, ...definition}) {
  const operation = defineOperation({id: operationId, family: 'api', target, source,
    capability: capability(definition), definition});
  return validateApiOperation(operation);
}

/** Reject mislabeled capabilities and unsupported request features before any credential resolution. */
export function validateApiOperation(input) {
  const operation = operationInput(input), value = operation.definition;
  requireThat(operation.family === 'api', 'Expected an API operation.');
  keys(value, ['request', 'checks', 'extract', 'effects', 'recovery', 'timeoutMs', 'maxResponseBytes'], 'API definition'); request(value.request);
  requireThat(operation.capability === capability(value), 'API intent and capability disagree.');
  requireThat(Array.isArray(value.checks) && Array.isArray(value.extract ?? []), 'API checks and extraction must be arrays.');
  unique(value.checks.map(check => check.id), 'API checks');
  for (const check of value.checks) { keys(check, ['id', 'select', 'equals'], 'API check'); id(check.id); selector(check.select); requireThat(Object.hasOwn(check, 'equals'), 'API checks need an expected value.'); template(check.equals); }
  unique((value.extract ?? []).map(item => item.name), 'API outputs');
  for (const item of value.extract ?? []) {
    keys(item, ['name', 'type', 'select', 'sensitivity'], 'API extraction'); id(item.name); selector(item.select);
    oneOf(item.type, ['string', 'number', 'boolean', 'object', 'array', 'null']); oneOf(item.sensitivity, ['public', 'sensitive']);
  }
  keys(value.effects, ['readOnlyContract', 'confirmedStatuses', 'noEffectStatuses', 'contractRef'], 'API effects');
  statuses(value.effects.confirmedStatuses ?? []); statuses(value.effects.noEffectStatuses ?? []);
  requireThat(!(value.effects.confirmedStatuses ?? []).some(status => (value.effects.noEffectStatuses ?? []).includes(status)), 'Contradictory effect statuses.');
  if (value.effects.readOnlyContract !== undefined) {
    id(value.effects.readOnlyContract); requireThat(value.request.method === 'GET' && !value.effects.confirmedStatuses?.length, 'Read-only contracts require GET without declared mutations.');
  }
  if (value.effects.confirmedStatuses?.length || value.effects.noEffectStatuses?.length) id(value.effects.contractRef);
  const recovery = value.recovery ?? {}; keys(recovery, ['authentication', 'idempotency', 'reconcile'], 'API recovery');
  if (recovery.authentication) {
    keys(recovery.authentication, ['statuses', 'contractRef'], 'authentication contract'); statuses(recovery.authentication.statuses); id(recovery.authentication.contractRef);
    requireThat(recovery.authentication.statuses.length > 0 && recovery.authentication.statuses.every(status => [401, 403].includes(status) && value.effects.noEffectStatuses?.includes(status)), 'Refresh requires an explicit no-effect authentication rejection contract.');
  }
  if (recovery.idempotency) {
    keys(recovery.idempotency, ['contractRef', 'input'], 'idempotency contract'); id(recovery.idempotency.contractRef); id(recovery.idempotency.input);
    requireThat(!Object.hasOwn(value.request.headers ?? {}, 'idempotency-key'), 'The declared idempotency contract owns its key header.');
  }
  if (recovery.reconcile) {
    const probe = recovery.reconcile; keys(probe, ['request', 'readOnlyContract', 'status', 'select', 'equals', 'whenEqual'], 'reconciliation');
    request(probe.request, true); id(probe.readOnlyContract); requireThat(integer(probe.status, 100, 599), 'Reconciliation requires its response status.'); selector(probe.select);
    requireThat(Object.hasOwn(probe, 'equals'), 'Reconciliation requires an expected observation.'); template(probe.equals);
    oneOf(probe.whenEqual, ['confirmed-no-effect', 'confirmed-effect']);
  }
  requireThat(integer(value.timeoutMs ?? 10000, 1, 120000) && integer(value.maxResponseBytes ?? 1048576, 1, 8388608), 'API limits must be bounded.');
  return operation;
}

/** Bind values structurally. A value cannot introduce a URL, SQL fragment or raw header definition. */
export function bind(templateValue, bindings) {
  if (slot(templateValue)) { requireThat(bindings.has(templateValue.$input), 'API input binding is missing.'); return structuredClone(bindings.get(templateValue.$input)); }
  if (Array.isArray(templateValue)) return templateValue.map(value => bind(value, bindings));
  if (templateValue && typeof templateValue === 'object') return Object.fromEntries(Object.entries(templateValue).map(([name, value]) => [name, bind(value, bindings)]));
  return templateValue;
}

/** Constrain to the configured origin AND base path; reject ambiguous server-decoded paths. */
export function buildRequest(target, definition, bindings, idempotency) {
  const base = new URL(target.baseUrl), prefix = base.pathname.replace(/\/$/, '');
  const path = definition.path.replace(/\{([A-Za-z0-9_-]+)\}/g, (_, name) => {
    const value = bindings.get(name); requireThat(scalar(value) && value !== null && value !== undefined, 'Path parameters require bound scalar values.'); return encodeURIComponent(String(value));
  });
  requireThat(!/[{}]/.test(path) && !/%(?:2e|2f|5c|25|00)/i.test(path) && !path.split('/').some(part => ['.', '..'].includes(part)), 'Ambiguous API path is refused.');
  const url = new URL(`${prefix}${path}`, base.origin);
  requireThat(url.origin === base.origin && !url.username && !url.password && (prefix === '' || url.pathname.startsWith(`${prefix}/`)), 'API destination escapes its target.');
  for (const [name, value] of Object.entries(bind(definition.query ?? {}, bindings))) { requireThat(scalar(value), 'Bound query must be scalar.'); url.searchParams.set(name, String(value)); }
  const headers = bind(definition.headers ?? {}, bindings);
  for (const value of Object.values(headers)) requireThat(typeof value === 'string' && !/[\r\n\0]/.test(value), 'Bound headers must be valid text.');
  if (idempotency) {
    const value = bindings.get(idempotency.input); requireThat(typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value), 'Idempotency contract needs a bound key.'); headers['idempotency-key'] = value;
  }
  const body = definition.json === undefined ? undefined : Buffer.from(JSON.stringify(bind(definition.json, bindings)));
  requireThat(!body || body.length <= 1048576, 'API request body exceeds 1 MiB.');
  if (body) headers['content-type'] ??= 'application/json';
  requireThat(Buffer.byteLength(url.href) <= 16384 && Buffer.byteLength(JSON.stringify(headers)) <= 16384, 'API request metadata exceeds its limit.');
  return {url, method: definition.method, headers, body};
}

/** Missing fields remain missing; they never compare equal to null or an empty string. */
export function select(response, selectorValue) {
  let value = selectorValue.from === 'status' ? response.status : selectorValue.from === 'header' ? response.headers : selectorValue.from === 'json' ? response.json : response.text;
  for (const segment of selectorValue.path) {
    const part = selectorValue.from === 'header' ? String(segment).toLowerCase() : segment;
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
