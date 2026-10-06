import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fingerprint, frozen, data, id, keys, requireThat, unique, integer} from '../execution-core/data.mjs';
import {validateHandoff} from './handoff.mjs';
import {transaction, snapshot, relativeFile, reviewArtifact} from './storage.mjs';
export {createGenerationHandoff, sourceExpectations} from './handoff.mjs';
const CASE_GATE = 'case-assertions';

function mappingThat(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}

/** Review data only: do not pretend lexical method names prove executable coverage. */
function validateMapping(test, handoff) {
  const scenario = handoff.source.scenarios.find(s => s.id === test.scenarioId);
  mappingThat(Array.isArray(test.mapping) && test.mapping.length === scenario.steps.length, 'MAPPING_STEPS');
  const steps = new Set();
  const references = refs => Array.isArray(refs) && new Set(refs).size === refs.length && refs.every(ref =>
    typeof ref === 'string' && ref.length <= 200 && /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(ref));
  for (const row of test.mapping) {
    keys(row, ['step', 'actions', 'expectations'], 'candidate mapping');
    mappingThat(integer(row.step, 1, scenario.steps.length) && !steps.has(row.step), 'MAPPING_STEPS'); steps.add(row.step);
    mappingThat(references(row.actions) && Array.isArray(row.expectations), 'MAPPING_REFERENCES');
    const expected = handoff.expectations.filter(e => e.scenarioId === test.scenarioId && e.step === row.step).map(e => e.key).sort();
    mappingThat(row.expectations.every(e => e && typeof e.key === 'string') &&
      fingerprint(row.expectations.map(e => e.key).sort()) === fingerprint(expected), 'MAPPING_KEYS');
    for (const expectation of row.expectations) {
      keys(expectation, ['key', 'validations'], 'candidate expectation');
      mappingThat(references(expectation.validations) && expectation.validations.length > 0, 'MAPPING_REFERENCES');
    }
    mappingThat(row.actions.length > 0 || row.expectations.length > 0, 'MAPPING_REFERENCES');
  }
}

const nativeScope = candidate => fingerprint({config: candidate.config, tests: candidate.tests.map(({scenarioId, spec, project, titlePath}) =>
  ({scenarioId, spec, project, titlePath})).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))});

export async function beginGeneration(roots, handoffInput, author) {
  const handoff = validateHandoff(handoffInput); id(author);
  return transaction(roots, handoff.source.id, (state, save) => {
    requireThat(!state, 'This source already has generation history; continue it instead of resetting the repair budget.');
    const next = {version: 1, author, handoff, rounds: 0, candidates: [], reviews: [], runs: []}; save(next); return frozen(next);
  });
}

function candidateInput(roots, state, input) {
  const checked = data(input); keys(checked, ['config', 'tests', 'repair', 'migration'], 'generation candidate'); relativeFile(roots, checked.config);
  requireThat(Array.isArray(checked.tests) && checked.tests.length === state.handoff.source.scenarios.length, 'Candidate must cover exactly the source scenarios.');
  unique(checked.tests.map(t => t.scenarioId), 'candidate scenarios');
  unique(checked.tests.map(t => fingerprint([t.spec, t.project, t.titlePath])), 'candidate tests');
  for (const test of checked.tests) {
    keys(test, ['scenarioId', 'spec', 'project', 'titlePath', 'mapping'], 'candidate test'); relativeFile(roots, test.spec);
    requireThat(state.handoff.source.scenarios.some(s => s.id === test.scenarioId), 'Unexpected generated scenario.');
    requireThat(typeof test.project === 'string' && Array.isArray(test.titlePath) && test.titlePath.length > 0, 'Use an explicit project and complete test title path.');
    for (const title of [test.project, ...test.titlePath]) requireThat(typeof title === 'string' && (title === test.project || title.trim().length > 0) && !/[\r\n›<>\[\]]/.test(title) && title.trim() === title, 'Test identity cannot be represented unambiguously in a native test list.');
    validateMapping(test, state.handoff);
  }
  if (checked.repair !== undefined) requireThat(['script-defect', 'environment', 'review-findings'].includes(checked.repair), 'Classify the repair; preserve application failures rather than weakening assertions.');
  if (checked.migration !== undefined) requireThat(checked.migration === CASE_GATE, 'Unknown generation migration.');
  return checked;
}

/** One legacy gate transition is free; ordinary repairs retain the cumulative budget. */
export async function registerCandidate(roots, sourceId, input) {
  return transaction(roots, sourceId, (state, save) => {
    requireThat(state, 'Begin from a validated handoff.');
    const checked = candidateInput(roots, state, input), current = snapshot(roots);
    requireThat(current.files.some(f => f.path === checked.config) && checked.tests.every(t => current.files.some(f => f.path === t.spec)), 'Config and specs must be in the frozen consumer snapshot.');
    if (checked.migration) {
      const previous = state.candidates.at(-1);
      requireThat(previous && previous.gate === undefined && !state.candidates.some(c => c.gate === CASE_GATE), 'The legacy gate migration is available only once.');
      requireThat(nativeScope(previous) === nativeScope(checked), 'Gate migration must preserve the source and native test scope.');
    }
    if (state.candidates.length && (!checked.migration || checked.repair)) {
      requireThat(checked.repair && state.rounds < 3, 'Three cumulative repair rounds maximum; classify a repair before continuing.'); state.rounds++;
    } else if (!state.candidates.length) requireThat(!checked.repair && !checked.migration, 'Initial generation is not a repair or migration.');
    const candidate = {...checked, gate: CASE_GATE, revision: `revision-${randomUUID()}`, snapshot: current, round: state.rounds};
    state.candidates.push(candidate); save(state); return frozen(candidate);
  });
}

export function currentCandidate(roots, state) {
  const candidate = state?.candidates.at(-1); requireThat(candidate, 'No generated candidate.');
  requireThat(candidate.gate === CASE_GATE, 'Register the legacy gate migration before new verification.');
  requireThat(snapshot(roots).fingerprint === candidate.snapshot.fingerprint, 'Consumer files changed; register and review a repair before verification.');
  return candidate;
}

/** Reviewer identity is an auditable attestation, not authentication. Preserve the actual independent review. */
export async function recordGenerationReview(roots, sourceId, input) {
  return transaction(roots, sourceId, (state, save) => {
    const candidate = currentCandidate(roots, state), review = data(input);
    keys(review, ['revision', 'reviewer', 'verdict', 'findings', 'artifact'], 'generation review'); id(review.reviewer);
    requireThat(review.reviewer !== state.author && review.revision === candidate.revision, 'Independent review must cover this exact revision.');
    requireThat(['APPROVE', 'CHANGES-REQUIRED'].includes(review.verdict) && Array.isArray(review.findings), 'Invalid review verdict.');
    for (const finding of review.findings) {
      keys(finding, ['id', 'blocking', 'resolution', 'reason'], 'review finding'); id(finding.id);
      requireThat(typeof finding.blocking === 'boolean' && ['open', 'resolved', 'accepted'].includes(finding.resolution) && typeof finding.reason === 'string' && finding.reason.trim(), 'Findings need evidence and a resolution rationale.');
    }
    unique(review.findings.map(f => f.id), 'review findings');
    requireThat(review.verdict !== 'APPROVE' || !review.findings.some(f => f.blocking && f.resolution === 'open'), 'Blocking review findings remain open.');
    review.artifact = reviewArtifact(roots, review.artifact); state.reviews.push(review); save(state); return frozen(review);
  });
}

export function approvedCandidate(roots, state) {
  const candidate = currentCandidate(roots, state), review = state.reviews.filter(r => r.revision === candidate.revision).at(-1);
  requireThat(review?.verdict === 'APPROVE' && fingerprint(reviewArtifact(roots, review.artifact.path)) === fingerprint(review.artifact), 'An intact independent approval is required.');
  return candidate;
}

export async function generationStatus(roots, sourceId) {
  return transaction(roots, sourceId, state => {
    requireThat(state, 'Generation has not started.');
    let candidate; try {candidate = approvedCandidate(roots, state);} catch {return frozen({status: 'NEEDS_REVIEW', rounds: state.rounds, greens: 0});}
    const runs = state.runs.filter(r => r.revision === candidate.revision);
    for (const run of runs.filter(r => r.status === 'PASS')) {
      try {
        const receipt = JSON.parse(readFileSync(relativeFile(roots, run.receipt.path), 'utf8'));
        requireThat(run.gate === CASE_GATE && receipt.version === 2 && fingerprint(receipt) === run.receipt.fingerprint, 'Verification gate or receipt changed.');
      }
      catch {return frozen({status: 'NEEDS_REVIEW', rounds: state.rounds, greens: 0});}
    }
    const greens = runs.every(r => r.status === 'PASS') ? runs.length : 0;
    return frozen({status: runs.at(-1)?.status === 'STARTED' ? 'NEEDS_REVIEW' : greens === 2 ? 'READY' : runs.at(-1)?.status ?? 'UNVERIFIED', rounds: state.rounds, greens,
      revision: candidate.revision, sourceFingerprint: state.handoff.fingerprint, runs: runs.map(r => ({id: r.id, status: r.status}))});
  });
}

/** Historical presentation reads a recorded verdict; it never derives a new one. */
export async function verificationRecord(roots, sourceId, invocationId) {
  id(invocationId);
  return transaction(roots, sourceId, state => {
    const run = state?.runs.find(item => item.id === invocationId); requireThat(run && run.status !== 'STARTED', 'Verification did not finish.');
    const review = state.reviews.filter(item => item.revision === run.revision).at(-1);
    requireThat(review?.verdict === 'APPROVE' && fingerprint(reviewArtifact(roots, review.artifact.path)) === fingerprint(review.artifact), 'Verification review is unavailable or changed.');
    if (run.receipt) requireThat(fingerprint(JSON.parse(readFileSync(relativeFile(roots, run.receipt.path), 'utf8'))) === run.receipt.fingerprint, 'Native verification receipt changed.');
    return frozen(data(run));
  });
}
