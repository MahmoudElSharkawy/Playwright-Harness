import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fingerprint, digest} from '../../scripts/lib/execution-core/data.mjs';
import {readRequirements, saveRequirements} from '../../scripts/lib/requirements/index.mjs';
import {GAPCUE} from '../../scripts/lib/requirements/gapcue.mjs';

export const putRequirementFile = (roots, path, value) => {
  const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return path;
};
// Synthetic native-schema fixture, separate from the optional unmodified UI proof.
export function bindSyntheticReview(roots, analysisId = 'checkout', findingIds = ['latency'], details = {}) {
  const state = readRequirements(roots, analysisId), input = {id: 'req-' + state.snapshot.slice(0, 48), title: 'Synthetic', sections: [], images: [], findings: findingIds.map(id => ({id, kind: 'gap', title: id, why: 'Missing target', q: 'Which target?', anchors: [], ...details[id]}))};
  const path = `.harness/state/requirements/${analysisId}/synthetic-input-${state.snapshot}.json`; putRequirementFile(roots, path, input);
  state.review = {reviewId: 'synthetic-' + state.snapshot.slice(0, 12), storyId: input.id, snapshot: state.snapshot, dependency: {version: GAPCUE.version, commit: GAPCUE.commit, content: fingerprint(GAPCUE.files)}, input: path, inputFingerprint: fingerprint(input), root: `.harness/state/requirements/${analysisId}/native-${state.snapshot}`, findingIds, findingLinks: Object.fromEntries(findingIds.map(id => [id, [state.inventory[0].id]])), status: 'incomplete', handoff: null};
  const nativeStory = `${state.review.root}/${input.id}/v1/story.json`, nativePage = `${state.review.root}/${input.id}/v1/index.html`;
  putRequirementFile(roots, nativeStory, {...input, version: 1, reviewedAt: '2026-10-20'}); putRequirementFile(roots, nativePage, '<p>Synthetic native-schema fixture; no upstream code.</p>');
  state.review.nativeIdentity = {storySha256: digest(readFileSync(join(roots.projectRoot, nativeStory))), pageSha256: digest(readFileSync(join(roots.projectRoot, nativePage)))};
  state.analysisInvocations++; return saveRequirements(roots, analysisId, state);
}
export const nativeDecisions = state => ({gapcue: 1, story: state.review.storyId, schema: 2, status: {latency: 'approved'}, custom: [], qEdit: {latency: '<p>What is the accepted target?</p>'}, mode: 'all', cur: 0, comment: '<p>Manual final question: which target is accepted?</p>', dirty: true, updatedAt: 1});
