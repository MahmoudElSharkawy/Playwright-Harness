import {data, fingerprint, id, keys, requireThat, unique} from '../execution-core/data.mjs';
import {caseNotes} from '../reporting/case-notes.mjs';

/** Reporting may inventory an incomplete draft; generation still requires validateLocalSource. */
export function reportSource(input) {
  const source = data(input, 2 * 1024 * 1024, {maxNodes: 200000});
  const text = value => typeof value === 'string' && value.trim();
  keys(source, ['version', 'id', 'title', 'scenarios'], 'report source'); id(source.id);
  requireThat(source.version === 1 && text(source.title) && Array.isArray(source.scenarios) && source.scenarios.length > 0 && source.scenarios.length <= 500, 'Report source needs a known case inventory.');
  unique(source.scenarios.map(row => row.id), 'report source cases');
  for (const scenario of source.scenarios) {
    keys(scenario, ['id', 'title', 'steps', 'externalReferences'], 'report source case'); id(scenario.id);
    requireThat(text(scenario.title) && Array.isArray(scenario.steps) && scenario.steps.length <= 1000, 'Report cases need titles and bounded source steps.');
    for (const step of scenario.steps) {
      keys(step, ['action', 'expected'], 'report source step');
      requireThat(typeof step.action === 'string' && Array.isArray(step.expected) && step.expected.every(value => typeof value === 'string'), 'Report source steps must retain textual actions and expectations.');
    }
    if (scenario.externalReferences !== undefined) {
      requireThat(Array.isArray(scenario.externalReferences), 'Report external references must be an array.');
      for (const ref of scenario.externalReferences) {keys(ref, ['system', 'id'], 'report external reference'); requireThat(text(ref.system) && text(ref.id), 'Report external references need a system and ID.');}
    }
  }
  return source;
}

/** Original scope is an explicit association, never an inferred superset or a verdict. */
export function reportingContext(selected, input) {
  const context = data(input, 2 * 1024 * 1024, {maxNodes: 200000});
  keys(context, ['source', 'notes', 'sourceFingerprint', 'selectedSourceFingerprint'], 'generation reporting context');
  const source = reportSource(context.source), sourceFingerprint = fingerprint(source), selectedSourceFingerprint = fingerprint(selected);
  requireThat(context.sourceFingerprint === undefined || context.sourceFingerprint === sourceFingerprint, 'Requested source fingerprint changed.');
  requireThat(context.selectedSourceFingerprint === undefined || context.selectedSourceFingerprint === selectedSourceFingerprint, 'Selected source fingerprint changed.');
  requireThat(selected.scenarios.every(row => source.scenarios.some(original => original.id === row.id && fingerprint(original) === fingerprint(row))), 'Selected cases must be exact members of the requested source.');
  caseNotes(source, context.notes, selected.scenarios.map(row => row.id));
  return {source, sourceFingerprint, selectedSourceFingerprint, ...(context.notes === undefined ? {} : {notes: context.notes})};
}
