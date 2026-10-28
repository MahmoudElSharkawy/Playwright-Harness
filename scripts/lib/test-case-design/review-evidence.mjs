import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {keys, fingerprint, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {readBounded, publishExclusive} from '../execute/storage.mjs';
import {reviewArtifact} from '../generation/storage.mjs';

export const CLARITY_QUESTION = 'Can another agent identify the actor, starting state, target, inputs, action, observable outcome and necessary cleanup without inventing business information?';
const boundedText = value => typeof value === 'string' && value.trim() && value.length <= 1024 && !/[\x00-\x1f]/.test(value);

/** Retained host identifiers are auditable references, not authentication of an independent actor. */
function verifiedOutput(roots, state, assessment) {
  const evidence = assessment.evidence;
  requireThat(evidence, 'Retained independent reviewer run evidence is required; names and matching hashes alone do not establish review.');
  keys(evidence, ['host', 'runId', 'source', 'output'], 'review run evidence');
  requireThat(boundedText(evidence.host) && boundedText(evidence.runId) && evidence.source === state.source, 'Review run identity or source binding is missing or stale.');
  keys(evidence.output, ['path', 'sha256'], 'retained review output');
  const artifact = reviewArtifact(roots, evidence.output.path);
  requireThat(artifact.sha256 === evidence.output.sha256, 'Retained review output changed; independent re-review is required.');
  const output = contextData(readBounded(consumerPath(roots, artifact.path), 256 * 1024), 256 * 1024);
  keys(output, ['version', 'host', 'runId', 'source', 'proposal', 'reviewer', 'cases', 'requirements', 'duplicates', 'clarityQuestion'], 'actual reviewer output');
  const expected = {version: 1, host: evidence.host, runId: evidence.runId, source: state.source, proposal: state.proposal, reviewer: assessment.reviewer,
    cases: assessment.cases, requirements: assessment.requirements, duplicates: assessment.duplicates, clarityQuestion: CLARITY_QUESTION};
  requireThat(fingerprint(output) === fingerprint(expected), 'Retained reviewer output bindings or findings differ from this assessment.');
  return artifact;
}

export function retainReviewEvidence(roots, state, assessment) {
  const artifact = verifiedOutput(roots, state, assessment);
  const path = `.harness/state/test-case-design/${state.id}/reviews/${artifact.sha256}.json`, file = consumerPath(roots, path);
  if (!existsSync(file)) publishExclusive(file, readFileSync(consumerPath(roots, artifact.path)));
  requireThat(reviewArtifact(roots, path).sha256 === artifact.sha256, 'Immutable retained reviewer output changed.');
  return {...assessment, evidence: {...assessment.evidence, output: {path, sha256: artifact.sha256}}};
}

export function reviewEvidenceStatus(roots, state) {
  try {
    requireThat(roots && state.review, 'Retained review evidence has not been verified.');
    verifiedOutput(roots, state, state.review);
    return {valid: true, reason: 'Retained reviewer run and output match the reviewed source and proposal; identity is an auditable attestation.'};
  } catch (error) {return {valid: false, reason: error.code ? 'Retained review output is missing or inaccessible; independent re-review is required.' : error.message};}
}
