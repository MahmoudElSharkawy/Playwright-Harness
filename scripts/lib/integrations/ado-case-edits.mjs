import {createHash} from 'node:crypto';
import {keys} from '../project-config.mjs';
import {adoId, requireValue} from './config.mjs';
import {adoTestCaseType} from './ado-source.mjs';
import {editStepsXml, editableSteps} from './ado-step-edit.mjs';
import {parameterizedText} from './ado-steps.mjs';
import {AdoError} from './ado-client.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fieldNames = {title: 'System.Title', stepsXml: 'Microsoft.VSTS.TCM.Steps'};
const problem = error => error instanceof AdoError ? error.message : error.delivery ? 'ADO update was not verified; reconcile the receipt and refetch before retrying.' : error.code ? 'Local receipt or IO failed.' : error.message;
function validate(input) {
  keys(input, ['version', 'cases'], 'case-edit proposal');
  requireValue(input.version === 1 && Array.isArray(input.cases) && input.cases.length > 0 && input.cases.length <= 100 && Buffer.byteLength(JSON.stringify(input)) <= 2 * 1024 * 1024, 'Case edits need version 1, 1–100 selected cases and at most 2 MiB.');
  for (const row of input.cases) {
    keys(row, ['id', 'revision', 'title', 'steps', 'removeStepIds'], 'case edit'); adoId(row.id);
    requireValue(Number.isSafeInteger(row.revision) && row.revision > 0 && row.revision <= 2147483647, 'Every case edit needs a positive expected revision.');
    requireValue(row.title !== undefined || row.steps !== undefined, 'Supply a title or ordered steps for each selected case.');
    requireValue(row.removeStepIds === undefined || row.steps !== undefined, 'Step removals require a complete ordered steps list.');
    if (row.title !== undefined) requireValue(typeof row.title === 'string' && row.title.trim() && row.title.length <= 255 && !/[\x00-\x1f\ufffe\uffff]/.test(row.title), 'Case title must be nonempty, at most 255 characters and contain no control characters.');
  }
  requireValue(new Set(input.cases.map(row => adoId(row.id))).size === input.cases.length, 'Selected case IDs must be unique.');
}
function view(values) {
  const result = {...values};
  if (values.stepsXml !== undefined) result.steps = editableSteps(values.stepsXml).rows.map(row => ({id: row.id, type: row.node.attrs.type, action: parameterizedText(values.stepsXml.slice(row.action.openEnd, row.action.closeStart), row.action.attrs.isformatted !== 'false'), expected: parameterizedText(values.stepsXml.slice(row.expected.openEnd, row.expected.closeStart), row.expected.attrs.isformatted !== 'false')}));
  return result;
}

/** Explicit content editing only. No execution, generation or source history is touched. */
export async function editAdoCases(client, workItem, {input, execute = false, approval} = {}) {
  validate(input);
  requireValue(typeof execute === 'boolean', 'Case edit execution must be boolean.');
  requireValue(!execute || typeof approval === 'string' && /^[a-f0-9]{64}$/.test(approval), 'Execution requires --approval with the reviewed preview fingerprint.');
  const delivery = execute ? client.delivery('case-edits', true, approval) : undefined;
  const outcomes = input.cases.map(row => ({id: adoId(row.id), revision: row.revision, status: 'not-executed'}));
  function incomplete() {delivery.incomplete(); return {mode: 'incomplete', receipt: delivery.receipt, cases: outcomes};}
  const prepared = []; let destination;
  try {
    const project = await client.projectIdentity(), isCase = await adoTestCaseType(client);
    destination = {organizationUrl: client.configuration.organizationUrl, project: project.name, projectId: project.id};
    // Finish all reads and validate the full selected batch before any PATCH.
    for (const [index, change] of input.cases.entries()) {
      try {
        const item = await workItem(change.id), id = adoId(item.id);
        requireValue(isCase(item.fields['System.WorkItemType']), 'Selected work item is not in the configured test-case category.');
        requireValue(item.rev === change.revision, 'Stale case revision; refetch and obtain a fresh preview before editing.');
        const before = {}, after = {};
        if (change.title !== undefined) {before.title = item.fields[fieldNames.title]; requireValue(typeof before.title === 'string', 'Source case title is missing.'); after.title = change.title;}
        if (change.steps !== undefined) {
          before.stepsXml = item.fields[fieldNames.stepsXml];
          after.stepsXml = editStepsXml(before.stepsXml, item.fields, change.steps, change.removeStepIds);
        }
        const ops = Object.keys(after).filter(key => before[key] !== after[key]).map(key => ({op: 'add', path: `/fields/${fieldNames[key]}`, value: after[key]}));
        requireValue(Buffer.byteLength(JSON.stringify([{op: 'test', path: '/rev', value: item.rev}, ...ops])) <= client.configuration.maxResponseBytes, 'Case edit request exceeds the configured ADO body bound.');
        const review = {id, revision: item.rev, before: view(before), after: view(after), changedFields: ops.map(op => op.path.slice(8))};
        prepared.push({id, item, ops, after, review, index});
      } catch (error) {outcomes[index] = {...outcomes[index], status: 'failed', reason: problem(error)};}
    }
    if (outcomes.some(row => row.status === 'failed')) {
      if (execute) return incomplete();
      throw new Error(`Case-edit preview refused: ${outcomes.filter(row => row.status === 'failed').map(row => `case ${row.id}: ${row.reason}`).join(' ')}`);
    }
    const plan = {version: 1, destination, inputFingerprint: digest(input), cases: prepared.map(row => row.review)};
    const fingerprint = digest(plan);
    if (!execute) return {mode: 'dry-run', ...plan, fingerprint};
    requireValue(approval === fingerprint, 'Preview fingerprint changed; review and authorize a fresh preview.');
  } catch (error) {
    if (!execute) throw error;
    for (const row of outcomes) if (row.status === 'not-executed') row.reason = problem(error);
    return incomplete();
  }
  for (const update of prepared) {
    const outcome = outcomes[update.index];
    if (!update.ops.length) {outcome.status = 'no-op'; continue;}
    let dispatched = false;
    try {
      delivery.identified({workItemId: update.id, revision: update.item.rev});
      dispatched = true;
      await delivery.write('edit-case', `wit/workitems/${update.id}?api-version=7.1`, [{op: 'test', path: '/rev', value: update.item.rev}, ...update.ops], {patch: true});
      const after = await workItem(update.id);
      requireValue(after.rev === update.item.rev + 1 && Object.entries(update.after).every(([name, value]) => after.fields[fieldNames[name]] === value), 'Case edit readback did not verify the exact requested content and revision.');
      delivery.verified({workItemId: update.id, revision: after.rev});
      outcome.status = 'completed'; outcome.updatedRevision = after.rev;
    } catch (error) {
      outcome.status = !dispatched || error.delivery?.effect === 'not-executed' ? 'failed' : 'uncertain';
      outcome.reason = problem(error); return incomplete();
    }
  }
  return {...delivery.finish(), mode: outcomes.every(row => row.status === 'no-op') ? 'no-op' : 'execute', cases: outcomes};
}
