import {defineOperation} from '../execution-core/index.mjs';
import {operationInput} from '../execution-core/inputs.mjs';
import {keys, id, oneOf, requireThat, integer, unique} from '../execution-core/data.mjs';
import * as sqlserver from './sqlserver-syntax.mjs';
import * as postgresql from './postgresql-syntax.mjs';

export const databaseCapabilities = Object.freeze(['dbSelect', 'dbDml']);
const slot = value => value && typeof value === 'object' && Object.hasOwn(value, '$input');
function syntaxFor(engine = 'sqlserver') {oneOf(engine, ['sqlserver', 'postgresql']); return engine === 'sqlserver' ? sqlserver : postgresql;}

function selector(value) {
  keys(value, ['from', 'path'], 'database selector'); oneOf(value.from, ['rows', 'rowCount', 'affectedRows']);
  requireThat(Array.isArray(value.path) && value.path.length <= 4 && (value.from === 'rows' || value.path.length === 0), 'Invalid database selector path.');
  for (const part of value.path) requireThat(integer(part) || typeof part === 'string' && part.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(part), 'Invalid database selector segment.');
}
export function defineDatabaseOperation({id: operationId, target, source, ...definition}) {
  return validateDatabaseOperation(defineOperation({id: operationId, family: 'database', target, source, capability: syntaxFor(definition.engine).classifySql(definition.sql).capability, definition}));
}
export function validateDatabaseOperation(input) {
  const operation = operationInput(input), d = operation.definition;
  requireThat(operation.family === 'database', 'Expected a database operation.');
  keys(d, ['engine', 'sql', 'parameters', 'identifiers', 'checks', 'extract', 'affectedRows', 'restorationGuard', 'timeoutMs', 'maxRows', 'maxResponseBytes'], 'database definition');
  const syntax = syntaxFor(d.engine), classified = syntax.classifySql(d.sql);
  requireThat(operation.capability === classified.capability, 'SQL and capability disagree.');
  requireThat(Array.isArray(d.parameters ?? []) && Array.isArray(d.checks) && Array.isArray(d.extract ?? []), 'Database definitions need arrays.');
  unique((d.parameters ?? []).map(p => p.name.toLowerCase()), 'SQL parameters');
  syntax.validateParameters(d, classified);
  keys(d.identifiers ?? {}, classified.tokens.filter(t => t.kind === 'slot').map(t => t.value), 'identifier slots');
  for (const token of classified.tokens.filter(t => t.kind === 'slot')) {
    const spec = d.identifiers?.[token.value]; keys(spec, ['input', 'allowed'], 'identifier definition'); id(spec.input); unique(spec.allowed, 'identifier allowlist');
    requireThat(spec.allowed.length > 0, 'Dynamic identifiers require an allowlist.'); spec.allowed.forEach(syntax.quoteIdentifier);
  }
  unique(d.checks.map(c => c.id), 'database checks');
  for (const c of d.checks) {keys(c, ['id', 'select', 'equals'], 'database check'); id(c.id); selector(c.select); requireThat(Object.hasOwn(c, 'equals'), 'Database check needs an expected value.'); if (slot(c.equals)) {keys(c.equals, ['$input'], 'expected input'); id(c.equals.$input);}}
  unique((d.extract ?? []).map(e => e.name), 'database outputs');
  for (const e of d.extract ?? []) {keys(e, ['name', 'type', 'sensitivity', 'select'], 'database output'); id(e.name); oneOf(e.type, ['string', 'number', 'boolean', 'object', 'array', 'null']); oneOf(e.sensitivity, ['public', 'sensitive']); selector(e.select);}
  if (d.affectedRows) {keys(d.affectedRows, ['min', 'max'], 'affected-row expectation'); requireThat(operation.capability === 'dbDml' && integer(d.affectedRows.min) && integer(d.affectedRows.max, d.affectedRows.min), 'Invalid affected-row expectation.');}
  if (d.restorationGuard) {
    keys(d.restorationGuard, ['identityParameter', 'versionParameter'], 'restoration guard');
    for (const name of Object.values(d.restorationGuard)) requireThat(d.parameters?.some(p => p.name === name), 'Restoration guard needs bound parameters.');
    requireThat(d.restorationGuard.identityParameter !== d.restorationGuard.versionParameter && d.affectedRows?.min === 1 && d.affectedRows.max === 1, 'Restoration needs distinct guards and exactly one affected row.');
    const version = d.parameters.find(p => p.name === d.restorationGuard.versionParameter);
    syntax.validateVersionParameter(version);
    syntax.validateRestoration(d.sql, d.restorationGuard, d.parameters);
  }
  requireThat(integer(d.timeoutMs ?? 10000, 1, 120000) && integer(d.maxRows ?? 1000, 1, 10000) && integer(d.maxResponseBytes ?? 1048576, 1, 8388608), 'Database limits must be bounded.');
  return operation;
}

export function bindDatabase(definition, bindings) {
  let text = definition.sql; const syntax = syntaxFor(definition.engine);
  for (const token of syntax.classifySql(text).tokens.filter(t => t.kind === 'slot').reverse()) {
    const spec = definition.identifiers[token.value], value = bindings.get(spec.input);
    requireThat(spec.allowed.includes(value), 'Dynamic SQL identifier is outside its allowlist.');
    text = text.slice(0, token.start) + syntax.quoteIdentifier(value) + text.slice(token.end);
  }
  const parameters = (definition.parameters ?? []).map(p => {requireThat(bindings.has(p.input), 'SQL input is missing.'); return {...p, value: bindings.get(p.input)};});
  // Resolved identifiers must satisfy the same scope/classification rules as fixed SQL.
  const classified = syntax.classifySql(text);
  return {text, parameters, command: classified.command, capability: classified.capability, ...(definition.restorationGuard ? {guard: {...syntax.validateRestoration(text, definition.restorationGuard, definition.parameters), ...definition.restorationGuard}} : {})};
}
export function select(result, value) {
  let selected = result[value.from];
  for (const part of value.path) {if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, part)) return undefined; selected = selected[part];}
  return selected;
}
export function expected(check, bindings) {if (slot(check.equals)) {requireThat(bindings.has(check.equals.$input), 'Expected input is missing.'); return bindings.get(check.equals.$input);} return check.equals;}
