import {data, fingerprint, requireThat} from '../execution-core/data.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const scalarId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const identity = value => object(value) ? value.id ?? value.accountId ?? value.value ?? value.name ?? value : value;
export const sameFieldValue = (actual, expected) => Array.isArray(expected)
  ? Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => sameFieldValue(actual[index], value))
  : object(expected) && identity(expected) !== expected ? identity(actual) === identity(expected) : fingerprint(actual ?? null) === fingerprint(expected ?? null);
const empty = value => value === undefined || value === null || typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length;
const scalarTypes = ['string', 'number', 'integer', 'boolean', 'date', 'datetime', 'option', 'priority', 'project', 'issuetype', 'component', 'version', 'resolution', 'securitylevel', 'user'];
const documentField = field => field.fieldId === 'description' || field.schema?.custom?.endsWith(':textarea');
const supported = field => documentField(field) || scalarTypes.includes(field.schema?.type) || field.schema?.type === 'array' && scalarTypes.includes(field.schema.items);

export function nativeFieldValues(value = {}) {
  requireThat(object(value) && Object.keys(value).length <= 100 && Object.keys(value).every(name => name.trim() === name && name.length > 0 && name.length <= 200 && !/[\x00-\x1f]/.test(name)), 'Native fields need a bounded object keyed by native field ID or name.');
  return data(value, 128 * 1024);
}

export function validateFieldMetadata(fields) {
  requireThat(Array.isArray(fields) && fields.length <= 1000 && new Set(fields.map(field => field?.fieldId)).size === fields.length
    && fields.every(field => object(field) && typeof field.fieldId === 'string' && field.fieldId.trim() === field.fieldId && field.fieldId.length > 0 && field.fieldId.length <= 200 && !/[\x00-\x1f]/.test(field.fieldId)
      && typeof field.name === 'string' && Array.isArray(field.operations) && field.operations.every(operation => typeof operation === 'string')
      && (field.required === undefined || typeof field.required === 'boolean') && (field.hasDefaultValue === undefined || typeof field.hasDefaultValue === 'boolean')
      && (field.allowedValues === undefined || Array.isArray(field.allowedValues) && field.allowedValues.length <= 1000)), 'Native field metadata is incomplete or ambiguous.');
  return data(fields, 1024 * 1024);
}

function validValue(field, value, retained = false) {
  const type = field.schema?.type;
  if (documentField(field)) return value?.type === 'doc' && value.version === 1 && Array.isArray(value.content);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (type === 'datetime') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (type === 'array') return Array.isArray(value) && value.length <= 100 && value.every(item => validValue({schema: {type: field.schema.items}}, item, retained));
  if (['option', 'priority', 'project', 'issuetype', 'component', 'version', 'resolution', 'securitylevel'].includes(type)) return object(value) && scalarId(value.id) && (retained || Object.keys(value).every(name => ['id', 'name', 'value'].includes(name)));
  if (type === 'user') return object(value) && scalarId(value.accountId) && (retained || Object.keys(value).every(name => name === 'accountId'));
  return false;
}

/** Shared preview checks; adapters supply native metadata and keep native wire values. */
export function validateNativeFields(fields, values, {existing = {}, implicit = [], label = 'Native case', creating = true} = {}) {
  validateFieldMetadata(fields); nativeFieldValues(values);
  const problems = [], review = fields.map(field => {
    const supplied = Object.hasOwn(values, field.fieldId), defaulted = creating && !supplied && field.hasDefaultValue === true && Object.hasOwn(field, 'defaultValue');
    const value = supplied ? values[field.fieldId] : defaulted ? field.defaultValue : existing[field.fieldId], readOnly = !field.operations.includes('set');
    if ((supplied || field.required) && !supported(field)) problems.push({field: field.fieldId, code: 'unsupported-type'});
    if (empty(value) && field.required && !(creating && !supplied && field.hasDefaultValue && !defaulted)) problems.push({field: field.fieldId, code: 'required'});
    if (supplied && readOnly) problems.push({field: field.fieldId, code: 'read-only'});
    const checkValue = supplied || defaulted || field.required && !empty(value);
    if (checkValue && !(value === null && field.required !== true && !creating) && !validValue(field, value, !supplied)) problems.push({field: field.fieldId, code: 'type'});
    if (checkValue && value !== null && field.allowedValues !== undefined) {
      const selected = Array.isArray(value) ? value : [value];
      if (!selected.every(item => field.allowedValues.some(allowed => sameFieldValue(allowed, item)))) problems.push({field: field.fieldId, code: 'allowed-value'});
    }
    return {field: field.fieldId, label: field.name, required: field.required === true, readOnly, type: field.schema?.type ?? 'unavailable',
      ...(value === undefined ? {} : {value}), ...(defaulted ? {defaulted: true} : {}), ...(field.allowedValues === undefined ? {} : {allowedValues: field.allowedValues})};
  });
  for (const name of Object.keys(values)) if (!implicit.includes(name) && !fields.some(field => field.fieldId === name)) problems.push({field: name, code: 'unavailable'});
  if (problems.length) throw Object.assign(new Error(`${label} fields need review: ${problems.map(row => `${row.field} (${row.code})`).join(', ')}. Supply supported native values before approval.`), {fieldProblems: problems, fieldReview: review});
  return review;
}
