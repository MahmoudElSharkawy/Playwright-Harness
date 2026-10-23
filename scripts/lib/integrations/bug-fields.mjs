import {requireValue} from './config.mjs';
import {fingerprint} from '../execution-core/data.mjs';

const FIELD_REFERENCE = /^[A-Za-z][A-Za-z0-9_.]{0,199}$/;
const MANAGED = new Set(['System.Id', 'System.Rev', 'System.WorkItemType', 'System.TeamProject', 'System.CreatedDate', 'System.CreatedBy', 'System.ChangedDate', 'System.ChangedBy', 'System.AuthorizedDate', 'System.AuthorizedAs', 'System.Watermark', 'System.NodeName']);
const TYPES = new Set(['string', 'plaintext', 'html', 'history', 'treepath', 'integer', 'double', 'boolean', 'datetime', 'guid', 'identity', 'pickliststring', 'picklistinteger', 'picklistdouble']);
const FALLBACKS = {title: 'System.Title', description: 'System.Description', reproSteps: 'Microsoft.VSTS.TCM.ReproSteps'};
const LIMITATIONS = ['Conditional rules, identities and paths require current server-side validation.'];
const missing = value => value === undefined || value === null || typeof value === 'string' && !value.trim();
const typeOf = spec => String(spec.type ?? '').toLowerCase();
const identityValues = value => (typeof value === 'string' ? [value] : value && typeof value === 'object' && !Array.isArray(value) ? [value.id, value.uniqueName, value.descriptor, value.displayName].filter(item => typeof item === 'string' && item.trim()) : []).map(item => item.toLowerCase());

function validType(spec, value) {
  const type = typeOf(spec);
  if (spec.isIdentity || type === 'identity') return identityValues(value).length > 0;
  if (['integer', 'double', 'picklistinteger', 'picklistdouble'].includes(type)) {
    if (typeof value !== 'string' && typeof value !== 'number' || String(value).trim() === '') return false;
    if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return false;
    const number = Number(value);
    return Number.isFinite(number) && (!type.endsWith('integer') || Number.isSafeInteger(number));
  }
  if (type === 'boolean') return [true, false, 'true', 'false'].includes(value);
  if (type === 'datetime') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T[^\r\n]+)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  if (type === 'guid') return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  return TYPES.has(type) && typeof value === 'string' && value.length <= 32768 && !value.includes('\0');
}

/** Allowed-value comparison preserves numeric picklists and refuses ambiguous identity labels. */
export function allowedFieldValue(spec, value) {
  if (!validType(spec, value) || !Array.isArray(spec.allowedValues)) return false;
  if (spec.isIdentity || typeOf(spec) === 'identity') {
    const supplied = new Set(identityValues(value));
    return spec.allowedValues.filter(item => identityValues(item).some(identity => supplied.has(identity))).length === 1;
  }
  const type = typeOf(spec), normalize = input => ['integer', 'double', 'picklistinteger', 'picklistdouble'].includes(type) ? Number(input) : type === 'boolean' ? input === true || input === 'true' : input;
  return spec.allowedValues.some(item => validType(spec, item) && normalize(item) === normalize(value));
}

/** Fresh reads are used at dispatch; an immutable fingerprint binds the exact observed schema/configuration. */
export async function loadBugSchema(client, {refresh = false} = {}) {
  const read = route => refresh ? client.read(route) : client.cachedRead(route), configured = client.configuration.bugs ?? {};
  let type = configured.workItemType;
  if (type === undefined) {
    const category = await read('wit/workitemtypecategories/Microsoft.BugCategory?api-version=7.1');
    requireValue(String(category.referenceName).toLowerCase() === 'microsoft.bugcategory' && Array.isArray(category.workItemTypes) && category.workItemTypes.length > 0 && category.workItemTypes.length <= 100, 'ADO Bug category is unavailable or incomplete.');
    type = category.defaultWorkItemType?.name ?? category.workItemTypes[0]?.name;
    requireValue(category.workItemTypes.some(item => item.name === type), 'ADO Bug category default has an invalid identity.');
  }
  requireValue(typeof type === 'string' && type.trim() && type.length <= 150 && !/[\/\\?#\r\n\0]/.test(type), 'ADO defect work-item type is invalid.');
  const fieldResult = await read(`wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=All&api-version=7.1`);
  const stateResult = await read(`wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1`);
  requireValue(Array.isArray(fieldResult.value) && fieldResult.value.length > 0 && fieldResult.value.length <= 1000 && (fieldResult.count === undefined || fieldResult.count === fieldResult.value.length), 'ADO defect fields are incomplete or exceed their bound.');
  requireValue(Array.isArray(stateResult.value) && stateResult.value.length > 0 && stateResult.value.length <= 100 && (stateResult.count === undefined || stateResult.count === stateResult.value.length), 'ADO defect states are incomplete or exceed their bound.');
  const fields = [], seen = new Set();
  for (const instance of fieldResult.value) {
    const referenceName = instance?.referenceName;
    requireValue(typeof referenceName === 'string' && FIELD_REFERENCE.test(referenceName) && !seen.has(referenceName), 'ADO defect field identity is invalid or duplicated.'); seen.add(referenceName);
    let detail = {};
    if (!instance.type) {
      detail = await read(`wit/fields/${encodeURIComponent(referenceName)}?api-version=7.1`);
      requireValue(detail.referenceName === referenceName && typeof detail.type === 'string', 'ADO field detail identity is incomplete or mismatched.');
    }
    const merged = {...detail, ...instance};
    requireValue(TYPES.has(typeOf(merged)), 'ADO defect field type is unavailable or unsupported.');
    requireValue(merged.allowedValues === undefined || Array.isArray(merged.allowedValues) && merged.allowedValues.length <= 1000, 'ADO defect allowed values exceed their bound.');
    requireValue(merged.name === undefined || typeof merged.name === 'string' && merged.name.length <= 512, 'ADO defect field label is invalid.');
    const field = {referenceName, name: merged.name ?? referenceName, type: merged.type, readOnly: [detail, instance].some(item => item.readOnly === true || item.isReadOnly === true) || MANAGED.has(referenceName), alwaysRequired: merged.alwaysRequired === true, isIdentity: detail.isIdentity === true || instance.isIdentity === true};
    for (const key of ['defaultValue', 'allowedValues', 'dependentFields']) if (merged[key] !== undefined) field[key] = merged[key];
    fields.push(field);
  }
  const mappings = {}, supplied = configured.fieldMap ?? {};
  for (const key of ['title', 'description', 'reproSteps', 'expected', 'actual']) {
    const referenceName = supplied[key] ?? FALLBACKS[key], field = fields.find(item => item.referenceName === referenceName);
    if (supplied[key] !== undefined) requireValue(field && !field.readOnly, `Bug ${key} field mapping is unavailable or read-only.`);
    if (field && !field.readOnly) mappings[key] = referenceName;
  }
  requireValue(mappings.title, 'Bug title mapping is unavailable or read-only.');
  requireValue(new Set(Object.values(mappings)).size === Object.values(mappings).length, 'Bug narrative field mappings overlap.');
  const states = stateResult.value.map(state => {
    requireValue(typeof state.name === 'string' && state.name.trim() && state.name.length <= 150 && typeof state.category === 'string' && state.category.length <= 100, 'ADO defect state metadata is incomplete.');
    return {name: state.name, category: state.category};
  });
  const schema = {type, fields, states, mappings, limitations: [...LIMITATIONS]};
  return {...schema, fingerprint: fingerprint({organizationUrl: client.configuration.organizationUrl, project: client.configuration.project, ...schema, configuration: configured})};
}

/** Local validation is a preflight, never a claim that hidden server rules, paths or identities passed. */
export function inspectBugFields(schema, values) {
  requireValue(values && typeof values === 'object' && !Array.isArray(values), 'Bug fields must be an object.');
  const problems = [], byName = new Map(schema.fields.map(field => [field.referenceName, field]));
  for (const [field, value] of Object.entries(values)) {
    const spec = byName.get(field);
    if (!spec) {problems.push({field, code: 'unavailable'}); continue;}
    if (spec.readOnly || MANAGED.has(field)) {problems.push({field, code: 'read-only'}); continue;}
    if (!validType(spec, value)) {problems.push({field, code: 'type'}); continue;}
    if (spec.allowedValues?.length && !allowedFieldValue(spec, value)) problems.push({field, code: 'allowed-value'});
  }
  const review = schema.fields.map(spec => {
    const field = spec.referenceName, readOnly = spec.readOnly === true || MANAGED.has(field), required = spec.alwaysRequired === true && !readOnly;
    const present = Object.hasOwn(values, field), supplied = present ? values[field] : spec.defaultValue;
    if (required && missing(supplied)) problems.push({field, code: 'required'});
    else if (!present && spec.defaultValue !== undefined && !readOnly && (!validType(spec, spec.defaultValue) || spec.allowedValues?.length && !allowedFieldValue(spec, spec.defaultValue))) problems.push({field, code: 'default-invalid'});
    const row = {field, label: spec.name ?? field, required, readOnly, type: spec.type};
    if (present) row.value = values[field];
    for (const key of ['defaultValue', 'allowedValues']) if (spec[key] !== undefined) row[key] = spec[key];
    return row;
  });
  return {ready: problems.length === 0, problems, review};
}
