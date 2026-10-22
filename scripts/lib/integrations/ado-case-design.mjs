import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {adoId, workItemLinkId} from './config.mjs';
import {editableSteps, editStepsXml} from './ado-step-edit.mjs';
import {parameterizedText, parseStepsXml, htmlToText} from './ado-steps.mjs';
import {escapeHtml} from '../requirements/review.mjs';
import {TEST_TYPES, SCENARIO_TYPES, preparationSteps} from '../test-case-design/review.mjs';

const FIELDS = ['System.Title', 'System.Description', 'Microsoft.VSTS.TCM.Steps', 'System.Tags', 'System.History'];
const CLASSIFICATIONS = [...TEST_TYPES, ...SCENARIO_TYPES].map(value => value.toLowerCase());
export const operationMarker = identity => `[pom-harness:test-case-design:${identity}]`;
export async function caseCapabilities(client, type) {
  const fields = await client.list(`wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=all&api-version=7.1`), global = await client.list('wit/fields?api-version=7.1');
  for (const name of FIELDS) requireThat(fields.some(field => field.referenceName === name) && global.some(field => field.referenceName === name && field.readOnly === false && field.isLocked !== true), `Test Case field ${name} is unavailable, locked or not writable.`);
  const tags = await client.list('wit/tags?api-version=7.1');
  requireThat(tags.every(tag => typeof tag.name === 'string'), 'Tag definitions are unavailable.');
  return fields;
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
export async function prepareCaseOperation(client, state, row, {validate = true} = {}) {
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
  const sharedWith = (before?.relations ?? []).filter(relation => relation.rel === 'Microsoft.VSTS.Common.TestedBy-Reverse').map(relation => workItemLinkId(relation.url, client.configuration.organizationUrl, project)).filter(id => id && id !== storyId);
  const different = Object.keys(fields).filter(name => fields[name] !== before?.fields[name]);
  if (row.proposedAction === 'Reuse unchanged') {
    requireThat(before, 'Reuse needs an existing case.');
    const actual = parseStepsXml(before.fields['Microsoft.VSTS.TCM.Steps']).map(step => ({action: step.action, expected: step.expected}));
    requireThat(before.fields['System.Title'] === row.title && fingerprint(actual) === fingerprint([...preparationSteps(row, preparation), ...row.steps]), 'Reuse content differs from the current case; propose the material update instead.');
    const existingTags = String(before.fields['System.Tags'] ?? '').split(';').map(tag => tag.trim()), description = htmlToText(before.fields['System.Description'] ?? '');
    const classifications = existingTags.filter(tag => CLASSIFICATIONS.includes(tag.toLowerCase()));
    requireThat(classifications.length === 2 && [row.testType, row.scenarioType].every(tag => classifications.includes(tag)) && description.includes(`Story ${storyId}`) && row.coverageReferences.every(ref => description.includes(ref.label)), 'Reuse classification or coverage reference differs from the current case.');
    return {caseId: row.id, identity, action: row.proposedAction, adoId: before.id, revision: before.rev, before, sharedWith, fields: before.fields, relation: null, request: null};
  }
  fields['System.History'] = operationMarker(identity);
  const relation = before ? null : {rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${storyId}`};
  const body = [...(before ? [{op: 'test', path: '/rev', value: before.rev}] : []), ...Object.entries(fields).map(([name, value]) => ({op: 'add', path: '/fields/' + name, value})), ...(relation ? [{op: 'add', path: '/relations/-', value: relation}] : [])];
  const request = {route: before ? `wit/workitems/${before.id}?api-version=7.1` : `wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`, method: before ? 'PATCH' : 'POST', body};
  const capabilities = await caseCapabilities(client, type);
  if (!before) for (const field of capabilities) requireThat(!field.alwaysRequired || field.defaultValue !== undefined && field.defaultValue !== null || Object.hasOwn(fields, field.referenceName) || ['System.WorkItemType', 'System.TeamProject', 'System.State', 'System.AreaPath', 'System.IterationPath'].includes(field.referenceName), `Required ${field.referenceName} needs an explicit supported delivery choice.`);
  if (validate) {
    if (before) await client.validateWorkItemUpdate(before.id, body);
    else await client.validateWorkItem(type, body, {fresh: true});
  }
  return {caseId: row.id, identity, action: row.proposedAction, adoId: before?.id ?? null, revision: before?.rev ?? null, before, sharedWith, fields, relation, request, changedFields: different, type};
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
  requireThat(Object.entries(operation.fields).every(([name, value]) => revision.fields[name] === value), 'Readback differs from the approved native fields.');
  requireThat(Object.entries(operation.fields).filter(([name]) => name !== 'System.History').every(([name, value]) => item.fields[name] === value), 'Case changed after the approved operation; revalidate affected coverage.');
  if (operation.relation) requireThat((item.relations ?? []).some(relation => relation.rel === operation.relation.rel && relation.url.toLowerCase() === operation.relation.url.toLowerCase()), 'Created case lacks the approved story relation.');
  if (operation.before) requireThat(fingerprint(item.relations ?? []) === fingerprint(operation.before.relations ?? []), 'Existing case relationships changed.');
  return item;
}
