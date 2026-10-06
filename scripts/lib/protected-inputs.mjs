import {randomBytes, randomUUID} from 'node:crypto';
import {data, digest, fingerprint, id, keys, integer, requireThat} from './execution-core/data.mjs';

export function validateGeneration(value) {
  keys(value, ['bytes', 'prefix', 'suffix'], 'credential generation');
  requireThat(integer(value.bytes, 16, 256), 'Credential generation needs 16–256 random bytes.');
  for (const part of ['prefix', 'suffix']) requireThat(value[part] === undefined || typeof value[part] === 'string' && value[part].length <= 64, 'Credential generation affixes must be bounded text.');
  return value;
}

/** Stable opaque identity, never the generated or synthetic credential itself. */
export function protectedInputReference(source) {
  const [kind, name] = source.split(':');
  requireThat(['env', 'generated', 'synthetic'].includes(kind) && name, 'Unknown protected input source.');
  if (kind === 'env') {
    requireThat(/^[A-Z][A-Z0-9_]{0,79}$/.test(name) && source === `env:${name}`, 'Invalid environment input source.');
    return `protected:${name}`;
  }
  id(name); requireThat(source === `${kind}:${name}`, 'Invalid protected input source.');
  return `protected:${kind}-${digest(source).slice(0, 32)}`;
}

/** One execution-owned store, also usable by API/DB exploration resolvers. */
export function createProtectedInputs(bindings, {environment = {}, references = {}} = {}) {
  requireThat(Array.isArray(bindings), 'Protected inputs must be an array.');
  const values = new Map(), declarations = new Map(), privateValues = [];
  for (const binding of bindings.filter(item => /^(?:env|generated|synthetic):/.test(item.source))) {
    const reference = protectedInputReference(binding.source), [kind, name] = binding.source.split(':');
    requireThat(kind === 'generated' || binding.generation === undefined, 'Only generated inputs declare generation rules.');
    const declaration = fingerprint(data({source: binding.source, ...(binding.generation ? {generation: binding.generation} : {})}));
    requireThat(!declarations.has(reference) || declarations.get(reference) === declaration, 'Protected input generation rules conflict.');
    if (values.has(reference)) continue;
    let value;
    if (kind === 'generated') {
      const rules = validateGeneration(binding.generation);
      value = (rules.prefix ?? '') + randomBytes(rules.bytes).toString('hex') + (rules.suffix ?? '');
    }
    else if (kind === 'synthetic') {
      requireThat(references[name] && !references[name].assumed, 'Synthetic input needs approved reference data.');
      value = references[name].value;
    } else value = environment[name];
    requireThat(typeof value === 'string' && value.length > 0 && value.length <= 8192, 'Protected input is unavailable or invalid.');
    values.set(reference, value); declarations.set(reference, declaration); privateValues.push(value);
  }
  return {
    privateValues,
    resolveSensitive(reference) {requireThat(values.has(reference), 'Protected input is unavailable.'); return values.get(reference);},
    storeSensitive(value) {const reference = `protected:${randomUUID()}`; values.set(reference, value); privateValues.push(typeof value === 'string' ? value : JSON.stringify(value)); return reference;},
    clear() {values.clear(); privateValues.length = 0;},
  };
}
