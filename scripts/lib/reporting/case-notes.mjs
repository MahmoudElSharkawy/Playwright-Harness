import {data, fingerprint, keys, requireThat, unique} from '../execution-core/data.mjs';
import {secretFindings} from '../package-validation.mjs';

/** Recorded blockers are annotations, never executed verdicts or readiness overrides. */
export function caseNotes(source, input, covered = []) {
  if (input === undefined) return new Map();
  const notes = data(input);
  keys(notes, ['version', 'sourceFingerprint', 'cases'], 'report blocker notes');
  requireThat(notes.version === 1 && notes.sourceFingerprint === fingerprint(source), 'Blocker notes differ from the captured source.');
  requireThat(Array.isArray(notes.cases) && notes.cases.length <= source.scenarios.length, 'Blocker notes must name source cases.');
  unique(notes.cases.map(note => note.scenarioId), 'report blocker cases');
  const text = value => typeof value === 'string' && value.trim() && value.length <= 4096;
  for (const note of notes.cases) {
    keys(note, ['scenarioId', 'stage', 'reason', 'nextAction'], 'case blocker');
    requireThat(source.scenarios.some(row => row.id === note.scenarioId) && !covered.includes(note.scenarioId), 'Blocker notes cannot replace generated or assessed cases.');
    requireThat(['SOURCE', 'REFINE', 'EXPLORE', 'PREPARE', 'AUTHOR'].includes(note.stage) && text(note.reason) && (note.nextAction === undefined || text(note.nextAction)), 'Blocker notes need a stage and a bounded reason.');
  }
  requireThat(!secretFindings('report-blockers.json', JSON.stringify(notes)).length, 'Blocker notes contain credential-like content.');
  return new Map(notes.cases.map(note => [note.scenarioId, note]));
}
