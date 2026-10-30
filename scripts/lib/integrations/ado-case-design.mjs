import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {adoId, workItemLinkId, validateCaseFieldValues} from './config.mjs';
import {workItemField, validFieldType, allowedFieldValue, equivalentFieldValue} from './bug-fields.mjs';
import {editableSteps, editStepsXml} from './ado-step-edit.mjs';
import {parameterizedText, parseStepsXml, htmlToText} from './ado-steps.mjs';
import {escapeHtml} from '../requirements/review.mjs';
import {TEST_TYPES, SCENARIO_TYPES, preparationSteps} from '../test-case-design/review.mjs';

const FIELDS = ['System.Title', 'System.Description', 'Microsoft.VSTS.TCM.Steps', 'System.Tags', 'System.History'];
const CLASSIFICATIONS = [...TEST_TYPES, ...SCENARIO_TYPES].map(value => value.toLowerCase());
export const operationMarker = identity => `[pom-harness:test-case-design:${identity}]`;
export async function caseCapabilities(client, type, {write = true} = {}) {
  const fields = await client.list(`wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=all&api-version=7.1`), global = await client.list('wit/fields?api-version=7.1');
  requireThat(fields.length > 0 && fields.length <= 1000 && new Set(fields.map(field => field.referenceName)).size === fields.length, 'Test Case field metadata is incomplete or duplicated.');
  const schema = fields.map(instance => {
    const detail = global.find(field => field.referenceName === instance.referenceName);
    requireThat(detail && detail.readOnly !== undefined, `Test Case field ${instance.referenceName} global writability is unavailable.`);
    return workItemField(instance, detail);
  });
  if (write) for (const name of FIELDS) requireThat(schema.some(field => field.referenceName === name && !field.readOnly), `Test Case field ${name} is unavailable, locked or not writable.`);
  const tags = await client.list('wit/tags?api-version=7.1');
  requireThat(tags.every(tag => typeof tag.name === 'string'), 'Tag definitions are unavailable.');
  return schema;
}

function publicationFields(client, schema, overrides, before, project) {
  validateCaseFieldValues(overrides);
  const values = {...(before ? {} : client.configuration.testCases?.fields ?? {}), ...overrides}, problems = [], missing = [];
  for (const [name, value] of Object.entries(values)) {
    const spec = schema.find(field => field.referenceName === name);
    if (FIELDS.includes(name)) {problems.push(`${name}: use the reviewed case content instead of a native override`); continue;}
    if (!spec) {problems.push(`${name}: unavailable in the selected Test Case type`); continue;}
    if (spec.readOnly) {problems.push(`${name}: read-only/server-managed assignment is not allowed`); continue;}
    if (!validFieldType(spec, value)) {problems.push(`${name}: invalid ${spec.type} type/value`); continue;}
    if (spec.allowedValues?.length && !allowedFieldValue(spec, value)) problems.push(`${name}: value is outside the allowed values`);
    if (['System.AreaPath', 'System.IterationPath'].includes(name) && (typeof value !== 'string' || value.split('\\')[0].toLowerCase() !== project.name.toLowerCase())) problems.push(`${name}: path belongs to another project`);
  }
  const supplied = {...before?.fields, ...values};
  for (const spec of schema) {
    const name = spec.referenceName;
    if (!spec.alwaysRequired || spec.readOnly || FIELDS.includes(name) || ['System.State', 'System.AreaPath', 'System.IterationPath'].includes(name)) continue;
    const value = Object.hasOwn(supplied, name) ? supplied[name] : before ? undefined : spec.defaultValue;
    if (value === undefined || value === null || typeof value === 'string' && !value.trim() && !allowedFieldValue(spec, value)) missing.push(`${name}: required writable value is missing`);
  }
  if (problems.length) throw Object.assign(new Error(`Test Case publication fields need correction: ${problems.join('; ')}.`), {fieldProblems: problems});
  return {values, missing, metadata: {overrides, schema: schema.filter(field => field.alwaysRequired || Object.hasOwn(values, field.referenceName)).sort((a, b) => a.referenceName.localeCompare(b.referenceName)), limitations: ['Conditional rules, identities and paths require current server-side validation.']}};
}

function validatedDefaults(schema, fields, item, before) {
  requireThat(item?.fields && typeof item.fields === 'object' && !Array.isArray(item.fields), 'ADO server validation returned incomplete Test Case fields.');
  for (const [name, value] of Object.entries(fields)) {
    const spec = schema.find(field => field.referenceName === name);
    requireThat(FIELDS.includes(name) ? item.fields[name] === value : equivalentFieldValue(spec, value, item.fields[name]), `ADO server validation changed requested field ${name}; review the field choice before publication.`);
  }
  const defaults = {}, preserved = [];
  for (const spec of schema) {
    const name = spec.referenceName, value = item.fields[name];
    if (spec.readOnly || FIELDS.includes(name) || Object.hasOwn(fields, name)) continue;
    if (before && Object.hasOwn(before.fields, name)) {
      requireThat(Object.hasOwn(item.fields, name) && (before.fields[name] === value || equivalentFieldValue(spec, before.fields[name], value)), `ADO server validation changed preserved field ${name}; request and review an explicit field update.`);
      preserved.push(name);
      continue;
    }
    if (value === undefined || value === null) continue;
    requireThat(validFieldType(spec, value), `ADO server validation returned an unsupported value for ${name}.`);
    defaults[name] = value;
  }
  return {defaults, preserved: preserved.sort()};
}

function matchesField(operation, name, expected, actual) {
  if (expected === actual) return true;
  const spec = !FIELDS.includes(name) && operation.publicationFields?.schema.find(field => field.referenceName === name);
  return spec ? equivalentFieldValue(spec, expected, actual) : expected === actual;
}
function steps(row, preparation, old) {
  const setup = preparationSteps(row, preparation), desired = [...setup, ...row.steps];
  const xml = old?.fields['Microsoft.VSTS.TCM.Steps'] ?? '<steps id="0" last="0"></steps>', parsed = editableSteps(xml, old?.fields ?? {});
  const first = parsed.rows[0], firstText = first && parameterizedText(xml.slice(first.action.openEnd, first.action.closeStart), first.action.attrs.isformatted !== 'false');
  const hasPreparation = /^Preparation\s+Prerequisites:/i.test(firstText ?? '');
  let preparationCount = hasPreparation ? 1 : 0;
  while (preparationCount && preparationCount < parsed.rows.length) {
    const part = parsed.rows[preparationCount].action, action = parameterizedText(xml.slice(part.openEnd, part.closeStart), part.attrs.isformatted !== 'false');
    if (!new RegExp(`^Preparation ${preparationCount + 1}\\s`).test(action)) break;
    preparationCount++;
  }
  const business = parsed.rows.slice(preparationCount);
  let next = parsed.last;
  const ids = [...setup.map((_, index) => index < preparationCount ? parsed.rows[index].id : ++next), ...row.steps.map((_, index) => business[index]?.id ?? ++next)];
  return editStepsXml(xml, old?.fields ?? {}, desired.map((step, index) => ({id: ids[index], action: {text: step.action}, expected: {text: step.expected}})), parsed.rows.filter(step => !ids.includes(step.id)).map(step => step.id));
}
function description(row, storyId, old) {
  const begin = `<!-- pom-harness:coverage:story-${storyId} -->`, end = `<!-- /pom-harness:coverage:story-${storyId} -->`;
  const block = begin + '<p>Coverage reference: Story ' + storyId + ' — ' + row.coverageReferences.map(ref => escapeHtml(ref.label)).join('; ') + '.</p>' + end;
  const before = old?.fields['System.Description'] ?? ''; requireThat(typeof before === 'string', 'Existing Description is not a supported string.');
  const start = before.indexOf(begin), stop = before.indexOf(end);
  requireThat((start === -1) === (stop === -1) && (start === -1 || stop > start && before.indexOf(begin, start + begin.length) === -1 && before.indexOf(end, stop + end.length) === -1), 'Existing coverage block is malformed or duplicated; review before editing.');
  return start === -1 ? before + block : before.slice(0, start) + block + before.slice(stop + end.length);
}
function tags(row, old) {
  const before = old?.fields['System.Tags'] ?? ''; requireThat(typeof before === 'string', 'Existing Tags are unsupported.');
  return [...new Set([...before.split(';').map(value => value.trim()).filter(value => value && !CLASSIFICATIONS.includes(value.toLowerCase())), row.testType, row.scenarioType])].join('; ');
}
export async function prepareCaseOperation(client, state, row, {validate = true, fields: overrides = {}} = {}) {
  const captured = state.evidence.existing.find(item => String(item.id) === row.id), preparation = state.draft.preparations.find(item => item.caseId === row.id);
  const project = await client.projectIdentity(), storyId = state.evidence.requirements.origin.storyId;
  let before = null, type;
  if (captured) {
    before = await client.read(`wit/workitems/${adoId(row.id)}?$expand=relations&api-version=7.1`); await client.requireWorkItemProject(before);
    requireThat(before.rev === captured.rev && fingerprint(before.fields) === fingerprint(captured.fields) && fingerprint(before.relations ?? []) === fingerprint(captured.relations ?? []), 'Existing case changed; recapture and renew approval.');
    type = before.fields['System.WorkItemType'];
  } else {
    const category = await client.read('wit/workitemtypecategories/Microsoft.TestCaseCategory?api-version=7.1');
    requireThat(category.referenceName === 'Microsoft.TestCaseCategory' && typeof category.defaultWorkItemType?.name === 'string' && category.workItemTypes?.some(item => item.name === category.defaultWorkItemType.name), 'Test-case creation type is unavailable.');
    type = category.defaultWorkItemType.name;
  }
  const identity = fingerprint({consumer: state.consumer, proposal: state.proposal, caseId: row.id});
  const fields = {'System.Title': row.title, 'System.Description': description(row, storyId, before), 'Microsoft.VSTS.TCM.Steps': steps(row, preparation, before), 'System.Tags': tags(row, before)};
  const capabilities = await caseCapabilities(client, type, {write: row.proposedAction !== 'Reuse unchanged'}), extra = publicationFields(client, capabilities, overrides, before, project);
  Object.assign(fields, extra.values);
  const sharedWith = (before?.relations ?? []).filter(relation => relation.rel === 'Microsoft.VSTS.Common.TestedBy-Reverse').map(relation => workItemLinkId(relation.url, client.configuration.organizationUrl, project)).filter(id => id && id !== storyId);
  const different = Object.keys(fields).filter(name => fields[name] !== before?.fields[name]);
  if (row.proposedAction === 'Reuse unchanged') {
    requireThat(before, 'Reuse needs an existing case.');
    requireThat(Object.entries(extra.values).every(([name, value]) => equivalentFieldValue(capabilities.find(field => field.referenceName === name), value, before.fields[name])), 'Reuse has a material native field change; propose a reviewed Update instead.');
    const actual = parseStepsXml(before.fields['Microsoft.VSTS.TCM.Steps']).map(step => ({action: step.action, expected: step.expected}));
    requireThat(before.fields['System.Title'] === row.title && fingerprint(actual) === fingerprint([...preparationSteps(row, preparation), ...row.steps]), 'Reuse content differs from the current case; propose the material update instead.');
    const existingTags = String(before.fields['System.Tags'] ?? '').split(';').map(tag => tag.trim()), description = htmlToText(before.fields['System.Description'] ?? '');
    const classifications = existingTags.filter(tag => CLASSIFICATIONS.includes(tag.toLowerCase()));
    requireThat(classifications.length === 2 && [row.testType, row.scenarioType].every(tag => classifications.includes(tag)) && description.includes(`Story ${storyId}`) && row.coverageReferences.every(ref => description.includes(ref.label)), 'Reuse classification or coverage reference differs from the current case.');
    return {caseId: row.id, identity, action: row.proposedAction, adoId: before.id, revision: before.rev, before, sharedWith, fields: before.fields, relation: null, request: null, publicationFields: extra.metadata};
  }
  fields['System.History'] = operationMarker(identity);
  const relation = before ? null : {rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${storyId}`};
  const body = [...(before ? [{op: 'test', path: '/rev', value: before.rev}] : []), ...Object.entries(fields).map(([name, value]) => ({op: 'add', path: '/fields/' + name, value})), ...(relation ? [{op: 'add', path: '/relations/-', value: relation}] : [])];
  const request = {route: before ? `wit/workitems/${before.id}?api-version=7.1` : `wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`, method: before ? 'PATCH' : 'POST', body};
  if (validate) {
    let validated;
    try {
      validated = before ? await client.validateWorkItemUpdate(before.id, body) : await client.validateWorkItem(type, body, {fresh: true});
    } catch (error) {
      if (extra.missing.length && error.code === 'request-rejected' && [400, 422].includes(error.status)) throw Object.assign(new Error(`ADO server validation rejected required Test Case fields: ${extra.missing.join('; ')}.`), {fieldProblems: extra.missing});
      throw new Error(`ADO server validation rejected Test Case ${row.id}; check field values, identities, paths and conditional rules. ${error.message}`);
    }
    Object.assign(extra.metadata, validatedDefaults(capabilities, fields, validated, before));
    extra.metadata.schema = capabilities.filter(field => field.alwaysRequired || Object.hasOwn(fields, field.referenceName) || Object.hasOwn(extra.metadata.defaults, field.referenceName) || extra.metadata.preserved.includes(field.referenceName)).sort((a, b) => a.referenceName.localeCompare(b.referenceName));
  }
  return {caseId: row.id, identity, action: row.proposedAction, adoId: before?.id ?? null, revision: before?.rev ?? null, before, sharedWith, fields, relation, request, changedFields: different, type, publicationFields: extra.metadata};
}

export async function verifyCaseOperation(client, operation, id, {historical = false} = {}) {
  const item = await client.read(`wit/workitems/${adoId(id)}?$expand=relations&api-version=7.1`); await client.requireWorkItemProject(item);
  requireThat(item.id === id && Number.isInteger(item.rev), 'Case readback identity is incomplete.');
  if (operation.action === 'Reuse unchanged') {
    requireThat(item.rev === operation.revision && fingerprint(item.fields) === fingerprint(operation.fields) && fingerprint(item.relations ?? []) === fingerprint(operation.before.relations ?? []), 'Reused case changed.'); return item;
  }
  const expectedRevision = operation.revision === null ? 1 : operation.revision + 1;
  const revision = historical ? await client.read(`wit/workitems/${id}/revisions/${expectedRevision}?$expand=relations&api-version=7.1`) : item;
  requireThat(revision.id === id && revision.rev === expectedRevision && revision.fields?.['System.History'] === operationMarker(operation.identity), 'Operation identity is not present in the expected native history revision.');
  requireThat(Object.entries(operation.fields).every(([name, value]) => matchesField(operation, name, value, revision.fields[name])), 'Readback differs from the approved native fields.');
  requireThat(Object.entries(operation.fields).filter(([name]) => name !== 'System.History').every(([name, value]) => matchesField(operation, name, value, item.fields[name])), 'Case changed after the approved operation; revalidate affected coverage.');
  requireThat(Object.entries(operation.publicationFields?.defaults ?? {}).every(([name, value]) => matchesField(operation, name, value, revision.fields[name]) && matchesField(operation, name, value, item.fields[name])), 'Readback differs from the approved server-default fields.');
  requireThat((operation.publicationFields?.preserved ?? []).every(name => operation.before && Object.hasOwn(operation.before.fields, name) && Object.hasOwn(revision.fields, name) && Object.hasOwn(item.fields, name) && matchesField(operation, name, operation.before.fields[name], revision.fields[name]) && matchesField(operation, name, operation.before.fields[name], item.fields[name])), 'Readback changed an unrequested preserved field; retain uncertainty and review the native change.');
  if (operation.relation) requireThat((item.relations ?? []).some(relation => relation.rel === operation.relation.rel && relation.url.toLowerCase() === operation.relation.url.toLowerCase()), 'Created case lacks the approved story relation.');
  if (operation.before) requireThat(fingerprint(item.relations ?? []) === fingerprint(operation.before.relations ?? []), 'Existing case relationships changed.');
  return item;
}
