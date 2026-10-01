import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fingerprint, frozen, data, id, keys, requireThat, unique} from '../execution-core/data.mjs';
import {validateHandoff} from './handoff.mjs';
import {transaction, snapshot, relativeFile, reviewArtifact} from './storage.mjs';
export {createGenerationHandoff, sourceExpectations} from './handoff.mjs';

export async function beginGeneration(roots, handoffInput, author) {
  const handoff = validateHandoff(handoffInput); id(author);
  return transaction(roots, handoff.source.id, (state, save) => {
    requireThat(!state, 'This source already has generation history; continue it instead of resetting the repair budget.');
    const next = {version: 1, author, handoff, rounds: 0, candidates: [], reviews: [], runs: []}; save(next); return frozen(next);
  });
}

function candidateInput(roots, state, input) {
  const checked = data(input); keys(checked, ['config', 'tests', 'repair'], 'generation candidate'); relativeFile(roots, checked.config);
  requireThat(Array.isArray(checked.tests) && checked.tests.length === state.handoff.source.scenarios.length, 'Candidate must cover exactly the source scenarios.');
  unique(checked.tests.map(t => t.scenarioId), 'candidate scenarios');
  unique(checked.tests.map(t => fingerprint([t.spec, t.project, t.titlePath])), 'candidate tests');
  for (const test of checked.tests) {
    keys(test, ['scenarioId', 'spec', 'project', 'titlePath'], 'candidate test'); relativeFile(roots, test.spec);
    requireThat(state.handoff.source.scenarios.some(s => s.id === test.scenarioId), 'Unexpected generated scenario.');
    requireThat(typeof test.project === 'string' && Array.isArray(test.titlePath) && test.titlePath.length > 0, 'Use an explicit project and complete test title path.');
    for (const title of [test.project, ...test.titlePath]) requireThat(typeof title === 'string' && (title === test.project || title.trim().length > 0) && !/[\r\n›<>\[\]]/.test(title) && title.trim() === title, 'Test identity cannot be represented unambiguously in a native test list.');
  }
  if (checked.repair !== undefined) requireThat(['script-defect', 'environment', 'review-findings'].includes(checked.repair), 'Classify the repair; preserve application failures rather than weakening assertions.');
  return checked;
}

/** First candidate is free; every subsequent repair round consumes the same source's budget. */
export async function registerCandidate(roots, sourceId, input) {
  return transaction(roots, sourceId, (state, save) => {
    requireThat(state, 'Begin from a validated handoff.');
    const checked = candidateInput(roots, state, input), current = snapshot(roots);
    requireThat(current.files.some(f => f.path === checked.config) && checked.tests.every(t => current.files.some(f => f.path === t.spec)), 'Config and specs must be in the frozen consumer snapshot.');
    if (state.candidates.length) {requireThat(checked.repair && state.rounds < 3, 'Three cumulative repair rounds maximum; classify a repair before continuing.'); state.rounds++;}
    else requireThat(!checked.repair, 'Initial generation is not a repair.');
    const candidate = {...checked, revision: `revision-${randomUUID()}`, snapshot: current, round: state.rounds};
    state.candidates.push(candidate); save(state); return frozen(candidate);
  });
}

export function currentCandidate(roots, state) {
  const candidate = state?.candidates.at(-1); requireThat(candidate, 'No generated candidate.');
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
      try {requireThat(fingerprint(JSON.parse(readFileSync(relativeFile(roots, run.receipt.path), 'utf8'))) === run.receipt.fingerprint, 'Verification receipt changed.');}
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
