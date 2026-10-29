import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest, fingerprint} from '../../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put} from './requirements.mjs';
import * as review from '../../scripts/lib/test-case-design/review.mjs';

export const clarityQuestion = 'Can another agent identify the actor, starting state, target, inputs, action, observable outcome and necessary cleanup without inventing business information?';

/** Synthetic evidence tests the receipt contract; it is not an actual host review. */
export function retainAssessment(roots, state, input) {
  const {evidence, ...assessment} = input;
  assessment.duplicates ??= (review.exactDuplicates?.(state) ?? []).map(row => ({id: row.id, verdict: 'retain', reason: 'Synthetic reviewer explicitly retains these separate case identities.'}));
  const host = 'synthetic-fixture', runId = 'fixture-' + fingerprint(assessment).slice(0, 24);
  const output = {version: 1, host, runId, source: state.source, ...assessment, clarityQuestion};
  const path = `.harness/runs/design-review/${fingerprint(output)}.json`;
  put(roots, path, output);
  return {...assessment, evidence: {host, runId, source: state.source, output: {path, sha256: digest(readFileSync(join(roots.projectRoot, path)))}}};
}
