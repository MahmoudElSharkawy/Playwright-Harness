import {createHash} from 'node:crypto';
import {identifier, keys} from '../project-config.mjs';
import {secretFindings} from '../package-validation.mjs';

export const PHASES = Object.freeze(['SETUP', 'EXERCISE', 'VERIFY', 'CLEANUP', 'RESTORE']);
export const EVIDENCE_KINDS = Object.freeze(['observation', 'assertion', 'response', 'snapshot', 'screenshot', 'trace', 'reconciliation', 'lifecycle']);
export const fail = message => { throw new Error(message); };
export const requireThat = (condition, message) => { if (!condition) fail(message); };
export const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
export const id = value => requireThat(identifier(value), 'Invalid execution identifier.');
export const revision = value => requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value), 'Invalid source revision.');
export const oneOf = (value, choices) => requireThat(choices.includes(value), 'Invalid execution enum.');
export {keys};
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function frozen(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}

/** Bounded JSON only. Reject obvious credentials; callers must sanitize arbitrary observations. */
export function data(value, maxBytes = 1024 * 1024, {maxNodes = 20000} = {}) {
  const active = new Set(); let nodes = 0;
  function copy(item, depth) {
    requireThat(++nodes <= maxNodes && depth <= 32, 'Execution data exceeds structural limits.');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number') { requireThat(Number.isFinite(item), 'Execution numbers must be finite.'); return item; }
    requireThat(item && typeof item === 'object' && !active.has(item), 'Execution data must be acyclic JSON.');
    const array = Array.isArray(item);
    requireThat(array || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'Live handles are not execution data.');
    active.add(item);
    const result = array ? [] : {};
    for (const name of Reflect.ownKeys(item)) {
      if (array && name === 'length') continue;
      requireThat(typeof name === 'string' && !['__proto__', 'constructor', 'prototype'].includes(name), 'Invalid execution data key.');
      if (array) requireThat(/^(0|[1-9][0-9]*)$/.test(name) && Number(name) < item.length, 'Invalid JSON array property.');
      const property = Object.getOwnPropertyDescriptor(item, name);
      requireThat(property.enumerable && Object.hasOwn(property, 'value'), 'Accessors are not execution data.');
      // A definition may name a sensitive wire field without containing its value.
      // Only one plain, accessor-free binding reference is serializable there.
      const candidate = property.value;
      const bindingSlot = candidate && typeof candidate === 'object' && Object.getPrototypeOf(candidate) === Object.prototype
        && Reflect.ownKeys(candidate).length === 1 && Object.hasOwn(candidate, '$input')
        && Object.hasOwn(Object.getOwnPropertyDescriptor(candidate, '$input'), 'value')
        && identifier(Object.getOwnPropertyDescriptor(candidate, '$input').value);
      requireThat(!/^(?:password|passwd|pwd|secret|token|authorization|cookie|set-cookie|connectionString|apiKey|accessToken|refreshToken)$/i.test(name) || bindingSlot, 'Use a protected reference for sensitive data.');
      result[name] = copy(property.value, depth + 1);
    }
    if (array) requireThat(Object.keys(result).length === item.length, 'Sparse arrays are not execution data.');
    active.delete(item); return result;
  }
  const result = copy(value, 0), serialized = JSON.stringify(result);
  requireThat(Buffer.byteLength(serialized) <= maxBytes, 'Execution data exceeds its byte limit.');
  requireThat(secretFindings('execution.json', serialized).length === 0, 'Execution data contains a credential-like literal.');
  return result;
}

export function fingerprint(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name, canonical(item[name])])) : item;
  return digest(JSON.stringify(canonical(value)));
}

export function unique(values, label) {
  requireThat(Array.isArray(values) && new Set(values).size === values.length, `Invalid or duplicate ${label}.`);
}

/** Full artifact/attempt association; invocation distinguishes repeated calls from retries. */
export function identity(value) {
  keys(value, ['runId', 'scenarioId', 'operationId', 'invocationId', 'attemptId', 'phase', 'number'], 'attempt identity');
  for (const name of ['runId', 'scenarioId', 'operationId', 'invocationId', 'attemptId']) id(value[name]);
  oneOf(value.phase, PHASES); requireThat(integer(value.number, 1), 'Invalid attempt number.');
  return value;
}

export function references(value) { unique(value, 'evidence references'); value.forEach(id); }
export function protectedReference(value) {
  requireThat(typeof value === 'string' && /^protected:[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value), 'Use an opaque protected reference.');
}

/** Values carry a runtime-checked type and an immutable producer identity, never a secret value. */
export function typedValue(input, maxBytes) {
  const value = data(input, maxBytes);
  keys(value, ['name', 'type', 'sensitivity', 'value', 'protectedRef', 'producer'], 'typed value');
  id(value.name); oneOf(value.type, ['string', 'number', 'boolean', 'object', 'array', 'null']);
  oneOf(value.sensitivity, ['public', 'sensitive']);
  if (value.sensitivity === 'sensitive') {
    requireThat(!Object.hasOwn(value, 'value'), 'Sensitive values cannot be serialized.'); protectedReference(value.protectedRef);
  } else {
    requireThat(!Object.hasOwn(value, 'protectedRef') && Object.hasOwn(value, 'value'), 'Public values need a value.');
    const actual = value.value === null ? 'null' : Array.isArray(value.value) ? 'array' : typeof value.value;
    requireThat(actual === value.type, 'Typed value does not match its declared type.');
  }
  keys(value.producer, ['runId', 'scenarioId', 'attemptId', 'name'], 'value producer');
  for (const name of ['runId', 'scenarioId', 'name']) id(value.producer[name]);
  if (Object.hasOwn(value.producer, 'attemptId')) id(value.producer.attemptId);
  return frozen(value);
}
