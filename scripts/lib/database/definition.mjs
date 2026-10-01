import {defineOperation} from '../execution-core/index.mjs';
import {operationInput} from '../execution-core/inputs.mjs';
import {keys, id, oneOf, requireThat, integer, unique} from '../execution-core/data.mjs';
import {classifySql, quoteIdentifier, validateRestoration} from './sqlserver-syntax.mjs';

export const databaseCapabilities = Object.freeze(['dbSelect', 'dbDml']);
const parameterName = value => requireThat(typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value), 'Invalid SQL parameter name.');
const slot = value => value && typeof value === 'object' && Object.hasOwn(value, '$input');
const types = ['nvarchar', 'varchar', 'int', 'bigint', 'bit', 'float', 'decimal', 'datetime2', 'uniqueidentifier', 'varbinary'];

function selector(value) {
  keys(value, ['from', 'path'], 'database selector'); oneOf(value.from, ['rows', 'rowCount', 'affectedRows']);
  requireThat(Array.isArray(value.path) && value.path.length <= 4 && (value.from === 'rows' || value.path.length === 0), 'Invalid database selector path.');
  for (const part of value.path) requireThat(integer(part) || typeof part === 'string' && part.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(part), 'Invalid database selector segment.');
}
export function defineDatabaseOperation({id: operationId, target, source, ...definition}) {
  return validateDatabaseOperation(defineOperation({id: operationId, family: 'database', target, source, capability: classifySql(definition.sql).capability, definition}));
}
export function validateDatabaseOperation(input) {
  const operation = operationInput(input), d = operation.definition;
  requireThat(operation.family === 'database', 'Expected a database operation.');
  keys(d, ['sql', 'parameters', 'identifiers', 'checks', 'extract', 'affectedRows', 'restorationGuard', 'timeoutMs', 'maxRows', 'maxResponseBytes'], 'database definition');
  const classified = classifySql(d.sql);
  requireThat(operation.capability === classified.capability, 'SQL and capability disagree.');
  requireThat(Array.isArray(d.parameters ?? []) && Array.isArray(d.checks) && Array.isArray(d.extract ?? []), 'Database definitions need arrays.');
  unique((d.parameters ?? []).map(p => p.name.toLowerCase()), 'SQL parameters');
  for (const p of d.parameters ?? []) {
    keys(p, ['name', 'type', 'input', 'length', 'precision', 'scale'], 'SQL parameter'); parameterName(p.name); id(p.input); oneOf(p.type, types);
    if (['nvarchar', 'varchar', 'varbinary'].includes(p.type)) requireThat(integer(p.length, 1, p.type === 'nvarchar' ? 4000 : 8000), 'Text/binary bindings need an explicit bounded length.');
    else requireThat(p.length === undefined, 'Unexpected binding length.');
    if (p.type === 'decimal') requireThat(integer(p.precision, 1, 38) && integer(p.scale, 0, p.precision), 'Decimal needs precision and scale.');
    else requireThat(p.precision === undefined && p.scale === undefined, 'Unexpected decimal metadata.');
  }
  for (const token of classified.tokens.filter(t => t.kind === 'parameter' && !t.value.startsWith('@@'))) requireThat(d.parameters?.some(p => `@${p.name}`.toLowerCase() === token.value.toLowerCase()), 'SQL value parameter is not declared.');
  keys(d.identifiers ?? {}, classified.tokens.filter(t => t.kind === 'slot').map(t => t.value), 'identifier slots');
  for (const token of classified.tokens.filter(t => t.kind === 'slot')) {
    const spec = d.identifiers?.[token.value]; keys(spec, ['input', 'allowed'], 'identifier definition'); id(spec.input); unique(spec.allowed, 'identifier allowlist');
    requireThat(spec.allowed.length > 0, 'Dynamic identifiers require an allowlist.'); spec.allowed.forEach(quoteIdentifier);
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
    requireThat(version.type === 'varbinary' && version.length === 8, 'Restoration binds an eight-byte SQL Server rowversion.');
    validateRestoration(d.sql, d.restorationGuard);
  }
  requireThat(integer(d.timeoutMs ?? 10000, 1, 120000) && integer(d.maxRows ?? 1000, 1, 10000) && integer(d.maxResponseBytes ?? 1048576, 1, 8388608), 'Database limits must be bounded.');
  return operation;
}

export function bindDatabase(definition, bindings) {
  let text = definition.sql;
  for (const token of classifySql(text).tokens.filter(t => t.kind === 'slot').reverse()) {
    const spec = definition.identifiers[token.value], value = bindings.get(spec.input);
    requireThat(spec.allowed.includes(value), 'Dynamic SQL identifier is outside its allowlist.');
    text = text.slice(0, token.start) + quoteIdentifier(value) + text.slice(token.end);
  }
  const parameters = (definition.parameters ?? []).map(p => {requireThat(bindings.has(p.input), 'SQL input is missing.'); return {...p, value: bindings.get(p.input)};});
  // Resolved identifiers must satisfy the same scope/classification rules as fixed SQL.
  classifySql(text);
  return {text, parameters, ...(definition.restorationGuard ? {guard: {...validateRestoration(text, definition.restorationGuard), ...definition.restorationGuard}} : {})};
}
export function select(result, value) {
  let selected = result[value.from];
  for (const part of value.path) {if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, part)) return undefined; selected = selected[part];}
  return selected;
}
export function expected(check, bindings) {if (slot(check.equals)) {requireThat(bindings.has(check.equals.$input), 'Expected input is missing.'); return bindings.get(check.equals.$input);} return check.equals;}
